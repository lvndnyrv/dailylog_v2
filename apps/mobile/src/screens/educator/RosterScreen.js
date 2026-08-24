import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { useAuth } from '../../hooks/useAuth';
import { useAttendance } from '../../hooks/useAttendance';
import { useClassroom } from '../../hooks/useClassroom';
import { useNapTimer } from '../../hooks/useNapTimer';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/Toast';
import { ChildAvatar } from '../../components/ChildAvatar';
import { ClassroomSwitcher } from '../../components/ClassroomSwitcher';
import { EmptyState, LoadingScreen } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

const COLLAPSED_ROW_COUNT = 2;

export function getKidsDayPhase(date = new Date()) {
  const hour = date.getHours();
  if (hour < 11) return 'morning';
  if (hour < 15) return 'midday';
  return 'afternoon';
}

function formatAttendanceTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : format(parsed, 'h:mm');
}

function totalEntries(status) {
  return (status?.mealCount || 0)
    + (status?.sleepCount || 0)
    + (status?.diaperCount || 0)
    + (status?.activityCount || 0);
}

function ProfileAvatar({ profile, onPress }) {
  const initial = profile?.display_name?.[0]
    || profile?.full_name?.[0]
    || '?';

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.profileAvatar}
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      activeOpacity={0.75}
    >
      {profile?.avatar_url ? (
        <Image source={{ uri: profile.avatar_url }} style={styles.profileAvatarImage} />
      ) : (
        <Text style={styles.profileAvatarText}>{initial.toUpperCase()}</Text>
      )}
    </TouchableOpacity>
  );
}

function StatusChip({ label, tone = 'neutral', onPress }) {
  const chip = (
    <View style={[styles.statusChip, styles[`statusChip_${tone}`]]}>
      <Text style={[styles.statusChipText, styles[`statusChipText_${tone}`]]}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return chip;

  return (
    <TouchableOpacity
      onPress={event => {
        event.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.7}
    >
      {chip}
    </TouchableOpacity>
  );
}

function ChildRow({ item, onOpen, onStatusPress }) {
  return (
    <TouchableOpacity
      onPress={() => onOpen(item.child)}
      style={styles.childRow}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.child.first_name} ${item.child.last_name}`}
    >
      <View style={styles.childAvatarWrap}>
        <ChildAvatar child={item.child} size={38} fontSize={13} />
        {item.isPresent && <View style={styles.presentDot} />}
      </View>
      <Text style={styles.childName} numberOfLines={1}>
        {item.child.first_name} {item.child.last_name}
      </Text>
      <StatusChip
        label={item.chip}
        tone={item.tone}
        onPress={item.statusAction ? () => onStatusPress(item) : null}
      />
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

function RosterBucket({
  bucket,
  expanded,
  searchActive,
  onToggle,
  onOpen,
  onStatusPress,
}) {
  if (!bucket.items.length) return null;

  const visibleItems = searchActive || expanded
    ? bucket.items
    : bucket.items.slice(0, COLLAPSED_ROW_COUNT);
  const hiddenCount = bucket.items.length - visibleItems.length;

  return (
    <View style={styles.bucketWrap}>
      <View style={styles.bucketTitleRow}>
        <Text style={styles.bucketTitle}>{bucket.title}</Text>
        <View style={[styles.bucketCount, styles[`bucketCount_${bucket.tone}`]]}>
          <Text style={[styles.bucketCountText, styles[`bucketCountText_${bucket.tone}`]]}>
            {bucket.items.length}
          </Text>
        </View>
      </View>

      <View style={styles.bucketCard}>
        {visibleItems.map((item, index) => (
          <View key={item.child.id}>
            {index > 0 && <View style={styles.rowDivider} />}
            <ChildRow
              item={item}
              onOpen={onOpen}
              onStatusPress={onStatusPress}
            />
          </View>
        ))}
        {hiddenCount > 0 && (
          <>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              onPress={onToggle}
              style={styles.moreButton}
              accessibilityRole="button"
            >
              <Text style={styles.moreButtonText}>+ {hiddenCount} more children</Text>
            </TouchableOpacity>
          </>
        )}
        {!searchActive && expanded && bucket.items.length > COLLAPSED_ROW_COUNT && (
          <>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              onPress={onToggle}
              style={styles.moreButton}
              accessibilityRole="button"
            >
              <Text style={styles.moreButtonText}>Show less</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

export default function RosterScreen({ navigation }) {
  const { profile } = useAuth();
  const { active: activeClassroom } = useClassroom();
  const isFocused = useIsFocused();
  const [children, setChildren] = useState([]);
  const [logStatus, setLogStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBuckets, setExpandedBuckets] = useState({});
  const [now, setNow] = useState(new Date());

  const classroomId = activeClassroom?.id || profile?.classroom_id;
  const today = format(now, 'yyyy-MM-dd');
  const phase = getKidsDayPhase(now);

  const {
    attendance,
    getStatus: getAttendanceStatus,
    presentCount,
    refresh: refreshAttendance,
  } = useAttendance(classroomId, now, profile?.id);
  const {
    activeNaps,
    refresh: refreshNaps,
  } = useNapTimer(classroomId);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!classroomId) {
      setChildren([]);
      setLogStatus({});
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data: kids, error: kidsError } = await supabase
      .from('children')
      .select('*')
      .eq('classroom_id', classroomId)
      .is('archived_at', null)
      .order('first_name');

    if (kidsError) {
      showToast("We couldn't load this classroom.", 'error');
      setChildren([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const nextChildren = kids || [];
    setChildren(nextChildren);

    if (!nextChildren.length) {
      setLogStatus({});
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const childIds = nextChildren.map(child => child.id);
    const { data: logs } = await supabase
      .from('daily_logs')
      .select('id, child_id, notes, comments, sent_to_parents, sent_at')
      .in('child_id', childIds)
      .eq('log_date', today);

    const logIds = (logs || []).map(log => log.id);
    const [meals, sleeps, diapers, activities] = logIds.length
      ? await Promise.all([
        supabase.from('meal_entries').select('daily_log_id').in('daily_log_id', logIds),
        supabase.from('sleep_entries').select('daily_log_id, end_time').in('daily_log_id', logIds),
        supabase.from('diaper_entries').select('daily_log_id').in('daily_log_id', logIds),
        supabase.from('activity_entries').select('daily_log_id').in('daily_log_id', logIds),
      ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

    const byLog = {};
    const ensure = id => {
      byLog[id] ||= {
        mealCount: 0,
        sleepCount: 0,
        diaperCount: 0,
        activityCount: 0,
      };
      return byLog[id];
    };

    (meals.data || []).forEach(row => { ensure(row.daily_log_id).mealCount += 1; });
    (sleeps.data || []).forEach(row => { ensure(row.daily_log_id).sleepCount += 1; });
    (diapers.data || []).forEach(row => { ensure(row.daily_log_id).diaperCount += 1; });
    (activities.data || []).forEach(row => { ensure(row.daily_log_id).activityCount += 1; });

    const nextStatus = {};
    (logs || []).forEach(log => {
      nextStatus[log.child_id] = {
        ...log,
        ...ensure(log.id),
      };
    });
    setLogStatus(nextStatus);

    await Promise.all([refreshAttendance(), refreshNaps()]);
    setLoading(false);
    setRefreshing(false);
  }, [classroomId, refreshAttendance, refreshNaps, today]);

  useEffect(() => {
    if (isFocused) load();
  }, [isFocused, load]);

  const rosterItems = useMemo(() => children.map(child => {
    const attendanceStatus = getAttendanceStatus(child.id);
    return {
      child,
      attendanceStatus,
      attendance: attendance[child.id],
      isPresent: attendanceStatus === 'present',
      log: logStatus[child.id] || null,
      isNapping: Boolean(activeNaps[child.id]),
    };
  }), [activeNaps, attendance, children, getAttendanceStatus, logStatus]);

  const buckets = useMemo(() => {
    if (phase === 'morning') {
      const checkedIn = [];
      const notIn = [];

      rosterItems.forEach(item => {
        if (item.attendanceStatus === 'present') {
          const time = formatAttendanceTime(item.attendance?.checked_in_at);
          checkedIn.push({
            ...item,
            chip: time ? `In ${time}` : 'Checked in',
            tone: 'success',
          });
        } else if (item.attendanceStatus === 'departed') {
          notIn.push({ ...item, chip: 'Picked up', tone: 'neutral' });
        } else {
          notIn.push({
            ...item,
            chip: item.attendance?.status === 'absent' ? 'Absent' : 'Not in yet',
            tone: item.attendance?.status === 'absent' ? 'warning' : 'neutral',
          });
        }
      });

      return [
        { key: 'checked-in', title: 'Checked in', tone: 'success', items: checkedIn },
        { key: 'not-in', title: 'Not in yet', tone: 'neutral', items: notIn },
      ];
    }

    if (phase === 'midday') {
      const attention = [];
      const allGood = [];

      rosterItems.forEach(item => {
        if (!item.isPresent) {
          allGood.push({
            ...item,
            chip: item.attendanceStatus === 'departed' ? 'Picked up' : 'Not in today',
            tone: 'neutral',
          });
        } else if (item.isNapping) {
          allGood.push({ ...item, chip: 'Napping', tone: 'success' });
        } else if (!item.log?.mealCount) {
          attention.push({ ...item, chip: 'Log lunch', tone: 'warning' });
        } else if (!item.log?.sleepCount) {
          attention.push({ ...item, chip: 'Nap due', tone: 'warning' });
        } else {
          allGood.push({ ...item, chip: 'All logged', tone: 'primary' });
        }
      });

      return [
        { key: 'attention', title: 'Needs attention', tone: 'warning', items: attention },
        { key: 'all-good', title: 'All good', tone: 'primary', items: allGood },
      ];
    }

    const needsNote = [];
    const ready = [];
    const away = [];

    rosterItems.forEach(item => {
      if (!item.attendance?.checked_in_at && !item.log) {
        away.push({ ...item, chip: 'Not in today', tone: 'neutral' });
      } else if (item.log?.sent_to_parents) {
        ready.push({ ...item, chip: 'Report sent', tone: 'success' });
      } else if (item.log?.notes?.trim() || item.log?.comments?.trim() || totalEntries(item.log) >= 2) {
        ready.push({ ...item, chip: 'Report ready', tone: 'primary' });
      } else {
        needsNote.push({ ...item, chip: 'Add note', tone: 'warning' });
      }
    });

    return [
      { key: 'needs-note', title: 'Needs a note', tone: 'warning', items: needsNote },
      { key: 'ready', title: 'Ready to send', tone: 'primary', items: ready },
      { key: 'away', title: 'Not in today', tone: 'neutral', items: away },
    ];
  }, [phase, rosterItems]);

  const filteredBuckets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return buckets;
    return buckets.map(bucket => ({
      ...bucket,
      items: bucket.items.filter(({ child }) =>
        `${child.first_name} ${child.last_name}`.toLowerCase().includes(query)
      ),
    }));
  }, [buckets, searchQuery]);

  const attentionBucket = buckets.find(bucket =>
    bucket.key === 'attention' || bucket.key === 'needs-note'
  );
  const readyBucket = buckets.find(bucket => bucket.key === 'ready');
  const nappingCount = rosterItems.filter(item => item.isNapping).length;
  const readyCount = readyBucket?.items.length || 0;
  const needNoteCount = phase === 'afternoon' ? (attentionBucket?.items.length || 0) : 0;

  function openChild(child) {
    navigation.navigate('ChildProfile', { child });
  }

  function openDailyLog(child) {
    navigation.navigate('DailyLog', { child, date: today });
  }

  function handlePriorityAction() {
    if (phase === 'morning') {
      navigation.navigate('RollCall');
      return;
    }

    const priorityChild = attentionBucket?.items[0]?.child
      || readyBucket?.items[0]?.child
      || rosterItems[0]?.child;
    if (priorityChild) openDailyLog(priorityChild);
  }

  function toggleBucket(key) {
    setExpandedBuckets(current => ({ ...current, [key]: !current[key] }));
  }

  function refresh() {
    setRefreshing(true);
    load();
  }

  if (loading) return <LoadingScreen />;

  const firstName = profile?.display_name
    || profile?.full_name?.split(' ')[0]
    || 'there';
  const timeLabel = format(now, 'h:mm a').toUpperCase();
  const phaseConfig = phase === 'morning'
    ? {
      eyebrow: `${timeLabel} · MORNING`,
      icon: 'sunny-outline',
      title: 'Start the day',
      subtitle: `${presentCount} of ${children.length} checked in`,
      button: 'Take roll call',
    }
    : phase === 'midday'
      ? {
        eyebrow: `${timeLabel} · NAPTIME`,
        icon: 'moon-outline',
        title: 'Naps in progress',
        subtitle: `${nappingCount} napping · ${attentionBucket?.items.length || 0} still to log`,
        button: 'Log naps',
      }
      : {
        eyebrow: `${timeLabel} · WRAPPING UP`,
        icon: 'document-text-outline',
        title: 'Daily reports',
        subtitle: `${readyCount} ready · ${needNoteCount} need a note`,
        button: 'Review & send reports',
      };

  const hasSearchResults = filteredBuckets.some(bucket => bucket.items.length);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.greeting}>
              Good {phase === 'morning' ? 'morning' : 'afternoon'}, {firstName}
            </Text>
            <ClassroomSwitcher compact childCount={children.length} />
          </View>
          <ProfileAvatar
            profile={profile}
            onPress={() => navigation.navigate('ProfileTab')}
          />
        </View>

        <View style={styles.priorityBand}>
          <Text style={styles.priorityEyebrow}>{phaseConfig.eyebrow}</Text>
          <View style={styles.prioritySummary}>
            <View style={styles.priorityIcon}>
              <Ionicons name={phaseConfig.icon} size={23} color={colors.primary} />
            </View>
            <View style={styles.priorityCopy}>
              <Text style={styles.priorityTitle}>{phaseConfig.title}</Text>
              <Text style={styles.prioritySubtitle}>{phaseConfig.subtitle}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={handlePriorityAction}
            style={[styles.priorityButton, !children.length && styles.disabledButton]}
            disabled={!children.length}
            accessibilityRole="button"
          >
            <Text style={styles.priorityButtonText}>{phaseConfig.button}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.pickupShortcut}
          onPress={() => navigation.navigate('Pickups')}
          activeOpacity={0.76}
          accessibilityRole="button"
          accessibilityLabel="Open today's pickups"
        >
          <View style={styles.pickupShortcutIcon}>
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.pickupShortcutCopy}>
            <Text style={styles.pickupShortcutTitle}>Today’s pickups</Text>
            <Text style={styles.pickupShortcutText}>Verify passes before children leave</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </TouchableOpacity>

        {children.length > 0 && (
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={`Search ${children.length} children…`}
              placeholderTextColor={colors.textFaint}
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={19} color={colors.textFaint} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {!children.length ? (
          <EmptyState
            icon="🏫"
            message={"No children are assigned to this classroom yet.\nOpen Classroom to review the roster."}
          />
        ) : !hasSearchResults ? (
          <EmptyState icon="🔎" message={`No children match “${searchQuery.trim()}”.`} />
        ) : (
          filteredBuckets.map(bucket => (
            <RosterBucket
              key={bucket.key}
              bucket={bucket}
              expanded={Boolean(expandedBuckets[bucket.key])}
              searchActive={Boolean(searchQuery.trim())}
              onToggle={() => toggleBucket(bucket.key)}
              onOpen={openChild}
              onStatusPress={undefined}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  greeting: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 22,
    lineHeight: 26,
  },
  profileAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  profileAvatarText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  priorityBand: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  priorityEyebrow: {
    color: '#5B7CA8',
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  prioritySummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  priorityIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityCopy: { flex: 1 },
  priorityTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 18,
  },
  prioritySubtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 2,
  },
  priorityButton: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  priorityButtonText: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  disabledButton: { opacity: 0.5 },
  finishRollCall: { alignItems: 'center', paddingVertical: 2 },
  finishRollCallText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  pickupShortcut: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pickupShortcutIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  pickupShortcutCopy: { flex: 1, minWidth: 0 },
  pickupShortcutTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 14,
  },
  pickupShortcutText: {
    marginTop: 2,
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 11.5,
  },
  searchBar: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  bucketWrap: { marginBottom: spacing.lg },
  bucketTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  bucketTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 15,
  },
  bucketCount: {
    minWidth: 30,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  bucketCount_success: { backgroundColor: colors.successLight },
  bucketCount_warning: { backgroundColor: colors.amberLight },
  bucketCount_primary: { backgroundColor: colors.primaryLight },
  bucketCount_neutral: { backgroundColor: '#EEF2F7' },
  bucketCountText: { fontFamily: fonts.bold, fontSize: 12 },
  bucketCountText_success: { color: colors.success },
  bucketCountText_warning: { color: colors.amber },
  bucketCountText_primary: { color: colors.primary },
  bucketCountText_neutral: { color: colors.textFaint },
  bucketCard: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 18,
  },
  childRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  childAvatarWrap: { position: 'relative' },
  presentDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  childName: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 14.5,
  },
  statusChip: {
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusChip_success: { backgroundColor: colors.successLight },
  statusChip_warning: { backgroundColor: colors.amberLight },
  statusChip_primary: { backgroundColor: colors.primaryLight },
  statusChip_neutral: { backgroundColor: '#EEF2F7' },
  statusChipText: { fontFamily: fonts.bold, fontSize: 12 },
  statusChipText_success: { color: colors.success },
  statusChipText_warning: { color: colors.amber },
  statusChipText_primary: { color: colors.primary },
  statusChipText_neutral: { color: colors.textFaint },
  rowDivider: { height: 1, backgroundColor: colors.primarySoft },
  moreButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  moreButtonText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
});
