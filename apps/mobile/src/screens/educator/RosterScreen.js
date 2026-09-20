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
import { useParentNotifications } from '../../hooks/useParentNotifications';
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

export function attendanceChip(record, fallback = 'Not in yet') {
  if (record?.status === 'late') return { label: 'Coming', tone: 'primary' };
  if (record?.status === 'absent') {
    const reason = String(record.absence_reason || '').toLowerCase();
    if (reason === 'sick') return { label: 'Sick', tone: 'warning' };
    if (reason === 'appointment') return { label: 'Appointment', tone: 'warning' };
    if (reason === 'vacation') return { label: 'Vacation', tone: 'warning' };
    return { label: 'Absent', tone: 'warning' };
  }
  return { label: fallback, tone: 'neutral' };
}

function timeMinutes(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function displayMedicationTime(value) {
  const minutes = timeMinutes(value);
  if (minutes === null) return '';
  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function getDueMedicationTasks({
  authorizations = [],
  logs = [],
  children = [],
  presentChildIds = new Set(),
  now = new Date(),
}) {
  const today = format(now, 'yyyy-MM-dd');
  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  const childrenById = new Map(children.map(child => [child.id, child]));
  const logCounts = logs.reduce((counts, log) => {
    counts.set(log.authorization_id, (counts.get(log.authorization_id) || 0) + 1);
    return counts;
  }, new Map());

  return authorizations.flatMap(authorization => {
    if (
      !authorization.active
      || authorization.schedule_type !== 'scheduled'
      || authorization.start_date > today
      || (authorization.end_date && authorization.end_date < today)
      || !presentChildIds.has(authorization.child_id)
    ) return [];

    const times = (authorization.scheduled_times || [])
      .map(value => ({ value, minutes: timeMinutes(value) }))
      .filter(item => item.minutes !== null)
      .sort((left, right) => left.minutes - right.minutes);
    const givenCount = logCounts.get(authorization.id) || 0;
    const nextDose = times[givenCount];
    if (!nextDose || nextDose.minutes > currentMinutes + 30) return [];

    const child = childrenById.get(authorization.child_id);
    if (!child) return [];
    const delta = nextDose.minutes - currentMinutes;
    return [{
      authorization,
      child,
      scheduledTime: nextDose.value,
      timeLabel: displayMedicationTime(nextDose.value),
      status: delta < -15 ? 'overdue' : delta <= 0 ? 'due' : 'upcoming',
    }];
  }).sort((left, right) => timeMinutes(left.scheduledTime) - timeMinutes(right.scheduledTime));
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
  const opensAttendanceUpdate = Boolean(item.statusAction && onStatusPress);
  return (
    <TouchableOpacity
      onPress={() => opensAttendanceUpdate ? onStatusPress(item) : onOpen(item.child)}
      style={styles.childRow}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={opensAttendanceUpdate
        ? `Review ${item.chip} update for ${item.child.first_name} ${item.child.last_name}`
        : `Open ${item.child.first_name} ${item.child.last_name}`}
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
  const [medicationAuthorizations, setMedicationAuthorizations] = useState([]);
  const [medicationLogsToday, setMedicationLogsToday] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBuckets, setExpandedBuckets] = useState({});
  const [now, setNow] = useState(new Date());
  const notifications = useParentNotifications();

  const classroomId = activeClassroom?.id || profile?.classroom_id;
  const roomKey = (activeClassroom?.member_room_ids || [classroomId]).join(',');
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
      setMedicationAuthorizations([]);
      setMedicationLogsToday([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data: kids, error: kidsError } = await supabase
      .from('children')
      .select('*')
      .in('classroom_id', roomKey.split(','))
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
      setMedicationAuthorizations([]);
      setMedicationLogsToday([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const childIds = nextChildren.map(child => child.id);
    const [{ data: logs }, { data: authorizations, error: medicationError }] = await Promise.all([
      supabase
        .from('daily_logs')
        .select('id, child_id, notes, comments, sent_to_parents, sent_at')
        .in('child_id', childIds)
        .eq('log_date', today),
      supabase
        .from('medication_authorizations')
        .select('id, child_id, name, dosage, route, active, schedule_type, scheduled_times, start_date, end_date')
        .in('child_id', childIds)
        .eq('active', true),
    ]);

    if (medicationError) {
      showToast("We couldn't load today's medication schedule.", 'error');
      setMedicationAuthorizations([]);
      setMedicationLogsToday([]);
    } else {
      const activeAuthorizations = authorizations || [];
      setMedicationAuthorizations(activeAuthorizations);
      if (activeAuthorizations.length) {
        const dayStart = new Date(`${today}T00:00:00`);
        const dayEnd = new Date(`${today}T23:59:59.999`);
        const { data: doseLogs, error: doseError } = await supabase
          .from('medication_logs')
          .select('id, authorization_id, administered_at')
          .in('authorization_id', activeAuthorizations.map(item => item.id))
          .gte('administered_at', dayStart.toISOString())
          .lte('administered_at', dayEnd.toISOString());
        if (doseError) {
          showToast("We couldn't confirm today's medication doses.", 'error');
          setMedicationLogsToday([]);
        } else {
          setMedicationLogsToday(doseLogs || []);
        }
      } else {
        setMedicationLogsToday([]);
      }
    }

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
  }, [classroomId, refreshAttendance, refreshNaps, today, roomKey]);

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

  const dueMedicationTasks = useMemo(() => getDueMedicationTasks({
    authorizations: medicationAuthorizations,
    logs: medicationLogsToday,
    children,
    presentChildIds: new Set(
      rosterItems.filter(item => item.isPresent).map(item => item.child.id),
    ),
    now,
  }), [children, medicationAuthorizations, medicationLogsToday, now, rosterItems]);

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
          const chip = attendanceChip(item.attendance);
          notIn.push({
            ...item,
            chip: chip.label,
            tone: chip.tone,
            statusAction: Boolean(item.attendance?.absence_report_id),
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
          const chip = item.attendanceStatus === 'departed'
            ? { label: 'Picked up', tone: 'neutral' }
            : attendanceChip(item.attendance, 'Not in today');
          allGood.push({
            ...item,
            chip: chip.label,
            tone: chip.tone,
            statusAction: Boolean(item.attendance?.absence_report_id),
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
    const sent = [];
    const away = [];

    rosterItems.forEach(item => {
      if (!item.attendance?.checked_in_at && !item.log) {
        const chip = attendanceChip(item.attendance, 'Not in today');
        away.push({
          ...item,
          chip: chip.label,
          tone: chip.tone,
          statusAction: Boolean(item.attendance?.absence_report_id),
        });
      } else if (item.log?.sent_to_parents) {
        sent.push({ ...item, chip: 'Report sent', tone: 'success' });
      } else if (item.log?.notes?.trim() || item.log?.comments?.trim() || totalEntries(item.log) >= 2) {
        ready.push({ ...item, chip: 'Report ready', tone: 'primary' });
      } else {
        needsNote.push({ ...item, chip: 'Add note', tone: 'warning' });
      }
    });

    return [
      { key: 'needs-note', title: 'Needs a note', tone: 'warning', items: needsNote },
      { key: 'ready', title: 'Ready to send', tone: 'primary', items: ready },
      { key: 'sent', title: 'Sent today', tone: 'success', items: sent },
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
  const sentBucket = buckets.find(bucket => bucket.key === 'sent');
  const nappingCount = rosterItems.filter(item => item.isNapping).length;
  const readyCount = readyBucket?.items.length || 0;
  const sentCount = sentBucket?.items.length || 0;
  const needNoteCount = phase === 'afternoon' ? (attentionBucket?.items.length || 0) : 0;

  function openChild(child) {
    navigation.navigate('ChildProfile', { child });
  }

  function openDailyLog(child) {
    navigation.navigate('DailyLog', { child, date: today });
  }

  function openAttendanceUpdate(item) {
    if (!item.attendance?.absence_report_id) return;
    navigation.navigate('StaffAbsenceDetail', {
      childId: item.child.id,
      reportId: item.attendance.absence_report_id,
      startsOn: today,
      endsOn: today,
    });
  }

  function handlePriorityAction() {
    if (phase === 'morning') {
      navigation.navigate('RollCall');
      return;
    }

    const priorityChild = attentionBucket?.items[0]?.child
      || readyBucket?.items[0]?.child
      || sentBucket?.items[0]?.child
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
        title: readyCount || needNoteCount ? 'Daily reports' : 'Reports complete',
        subtitle: readyCount || needNoteCount
          ? `${readyCount} ready · ${needNoteCount} need a note`
          : `${sentCount} sent today`,
        button: readyCount || needNoteCount ? 'Review & send reports' : 'View sent reports',
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
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('StaffNotifications')}
              style={styles.notificationButton}
              accessibilityRole="button"
              accessibilityLabel={`Notifications${notifications.unreadCount ? `, ${notifications.unreadCount} unread` : ''}`}
            >
              <Ionicons name="notifications-outline" size={21} color={colors.textPrimary} />
              {notifications.unreadCount ? (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>{notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <ProfileAvatar
              profile={profile}
              onPress={() => navigation.navigate('ProfileTab')}
            />
          </View>
        </View>

        {(activeClassroom?.member_room_ids?.length || 0) > 1 && <View style={styles.priorityBand}>
          <Text style={styles.priorityTitle}>Shared-room roster</Text>
          <Text style={styles.prioritySubtitle}>Children from both rooms are shown during this combination. Their home rooms stay unchanged. Check Rooms &amp; ratios for the host and coverage.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('RoomRatios')}>
            <Text style={styles.prioritySubtitle}>View live combined ratio →</Text>
          </TouchableOpacity>
        </View>}
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
          {phase !== 'morning' && children.length > 0 ? (
            <TouchableOpacity
              style={styles.finishRollCall}
              onPress={() => navigation.navigate('RollCall')}
              accessibilityRole="button"
              accessibilityLabel="Review attendance"
            >
              <Text style={styles.finishRollCallText}>Review attendance</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {dueMedicationTasks.length > 0 ? (
          <View style={styles.medicationBand} accessibilityRole="summary">
            <View style={styles.medicationBandHeader}>
              <View style={styles.medicationBandIcon}>
                <Ionicons name="medical-outline" size={21} color={colors.danger} />
              </View>
              <View style={styles.medicationBandCopy}>
                <Text style={styles.medicationBandTitle}>
                  {dueMedicationTasks.length === 1 ? 'Medication check' : `${dueMedicationTasks.length} medication checks`}
                </Text>
                <Text style={styles.medicationBandSubtitle}>Review the signed label and complete all five safety rights.</Text>
              </View>
            </View>
            {dueMedicationTasks.slice(0, 2).map(task => (
              <TouchableOpacity
                key={task.authorization.id}
                style={styles.medicationTask}
                onPress={() => navigation.navigate('Medication', {
                  child: task.child,
                  authorizationId: task.authorization.id,
                  openDose: true,
                  linkedAt: Date.now(),
                })}
                activeOpacity={0.74}
                accessibilityRole="button"
                accessibilityLabel={`Review ${task.authorization.name} for ${task.child.first_name}`}
              >
                <View style={styles.medicationTaskCopy}>
                  <Text style={styles.medicationTaskTitle} numberOfLines={1}>
                    {task.child.first_name} · {task.authorization.name}
                  </Text>
                  <Text style={styles.medicationTaskMeta}>
                    {task.authorization.dosage} · {task.authorization.route || 'Route on label'} · {task.timeLabel}
                  </Text>
                </View>
                <View style={[
                  styles.medicationTimingBadge,
                  task.status === 'overdue' && styles.medicationTimingBadgeOverdue,
                ]}>
                  <Text style={[
                    styles.medicationTimingText,
                    task.status === 'overdue' && styles.medicationTimingTextOverdue,
                  ]}>
                    {task.status === 'overdue' ? 'Overdue' : task.status === 'due' ? 'Due now' : 'Coming up'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
              </TouchableOpacity>
            ))}
            {dueMedicationTasks.length > 2 ? (
              <Text style={styles.medicationMore}>+ {dueMedicationTasks.length - 2} more due medication checks</Text>
            ) : null}
          </View>
        ) : null}

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
              onStatusPress={openAttendanceUpdate}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  notificationButton: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface,
  },
  notificationBadge: {
    position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18,
    borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 2, borderColor: colors.bg, backgroundColor: colors.danger,
  },
  notificationBadgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 9 },
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
  medicationBand: {
    marginBottom: spacing.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#E8BEBE',
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  medicationBandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.dangerLight,
  },
  medicationBandIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  medicationBandCopy: { flex: 1, minWidth: 0 },
  medicationBandTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14.5 },
  medicationBandSubtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  medicationTask: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.primarySoft,
  },
  medicationTaskCopy: { flex: 1, minWidth: 0 },
  medicationTaskTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  medicationTaskMeta: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  medicationTimingBadge: { borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.amberLight },
  medicationTimingBadgeOverdue: { backgroundColor: colors.dangerLight },
  medicationTimingText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 10.5 },
  medicationTimingTextOverdue: { color: colors.danger },
  medicationMore: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, color: colors.primary, fontFamily: fonts.bold, fontSize: 11.5 },
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
