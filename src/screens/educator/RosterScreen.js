import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { useNapTimer } from '../../hooks/useNapTimer';
import { useAttendance } from '../../hooks/useAttendance';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/offlineQueue';
import { newId } from '../../lib/uuid';
import { showToast } from '../../components/Toast';
import { LoadingScreen, EmptyState, AllergyBadge } from '../../components/ui';
import { ClassroomSwitcher } from '../../components/ClassroomSwitcher';
import { ChildAvatar } from '../../components/ChildAvatar';
import { colors, spacing, radius } from '../../theme';
import { format, subDays, addDays, isToday as checkIsToday } from 'date-fns';

export default function RosterScreen({ navigation }) {
  const { profile }                     = useAuth();
  const { active: activeClassroom }     = useClassroom();
  const isFocused                       = useIsFocused();
  const [children, setChildren]         = useState([]);
  const [logStatus, setLogStatus]       = useState({});
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [filter, setFilter]             = useState('all');
  const [searchQuery, setSearchQuery]   = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const dateStr   = format(selectedDate, 'yyyy-MM-dd');
  const isToday   = checkIsToday(selectedDate);
  const classroomId = activeClassroom?.id || profile?.classroom_id;

  // Nap timer — only active for today
  const { isNapping, getElapsed, startNap, endNap } = useNapTimer(isToday ? classroomId : null);

  // Attendance — check-in/out per child for the selected day
  const {
    checkIn, checkOut, getStatus: getAttendanceStatus, presentCount,
  } = useAttendance(classroomId, selectedDate, profile?.id);

  // Quick action: check in / out toggle
  async function quickAttendance(childId, childName) {
    const status = getAttendanceStatus(childId);
    if (status === 'absent') {
      await checkIn(childId);
      showToast(`✅ ${childName} checked in`, 'success');
    } else if (status === 'present') {
      await checkOut(childId);
      showToast(`👋 ${childName} checked out`, 'success');
    } else {
      // departed → re-check-in
      await checkIn(childId);
      showToast(`✅ ${childName} checked back in`, 'success');
    }
  }

  // Quick action: ensure log exists and return its id
  async function ensureLogId(childId) {
    // Check logStatus cache first
    const cached = logStatus[childId];
    if (cached?.logId) return cached.logId;

    // Get or create today's log
    const { data: existing } = await supabase
      .from('daily_logs').select('id')
      .eq('child_id', childId).eq('log_date', dateStr).maybeSingle();
    if (existing) return existing.id;

    const id = newId();
    await mutate({
      type: 'upsert', table: 'daily_logs',
      data: { id, child_id: childId, log_date: dateStr, educator_id: profile.id },
      onConflict: 'child_id,log_date', ignoreDuplicates: true,
    });
    return id;
  }

  // Quick action: add meal with default values
  async function quickMeal(childId) {
    const logId = await ensureLogId(childId);
    if (!logId) return;
    const { error } = await mutate({
      type: 'insert', table: 'meal_entries',
      data: { id: newId(), daily_log_id: logId, time: format(new Date(), 'HH:mm'), food_type: '', amount: 'some' },
    });
    if (error) showToast('Couldn\'t add meal', 'error');
    else {
      showToast('🍽 Meal added', 'success');
      load(); // refresh counts
    }
  }

  // Quick action: add diaper
  async function quickDiaper(childId) {
    const logId = await ensureLogId(childId);
    if (!logId) return;
    const { error } = await mutate({
      type: 'insert', table: 'diaper_entries',
      data: { id: newId(), daily_log_id: logId, time: format(new Date(), 'HH:mm'), type: 'diaper', wet: true, bm: false },
    });
    if (error) showToast('Couldn\'t add diaper entry', 'error');
    else {
      showToast('🩲 Diaper logged', 'success');
      load();
    }
  }

  // Quick action: toggle nap
  async function quickNap(childId, childName) {
    if (isNapping(childId)) {
      await endNap(childId);
      showToast(`😴 ${childName}'s nap ended`, 'success');
    } else {
      const logId = await ensureLogId(childId);
      if (!logId) return;
      await startNap(childId, logId, childName);
      showToast(`😴 ${childName}'s nap started`, 'success');
    }
  }

  async function load() {
    if (!classroomId) return;

    const { data: kids } = await supabase
      .from('children')
      .select('*')
      .eq('classroom_id', classroomId)
      .is('archived_at', null)
      .order('first_name');

    setChildren(kids || []);

    if (kids?.length) {
      // Preferred: single RPC (see supabase-phase0-reconciliation.sql)
      const { data: statusRows, error: rpcError } = await supabase
        .rpc('get_classroom_log_status', { p_classroom_id: classroomId, p_date: dateStr });

      if (!rpcError && statusRows) {
        const status = {};
        statusRows.forEach(r => {
          if (r.log_id) {
            status[r.child_id] = {
              sent: r.sent,
              mood: r.moods?.[0],
              entryCount: Number(r.entry_count) || 0,
            };
          }
        });
        setLogStatus(status);
      } else {
        // Fallback (migration not applied yet): 4 batched queries instead of 3-per-child
        const { data: logs } = await supabase
          .from('daily_logs')
          .select('id, child_id, sent_to_parents, moods')
          .in('child_id', kids.map(k => k.id))
          .eq('log_date', dateStr);

        const logIds = (logs || []).map(l => l.id);
        const counts = {};
        if (logIds.length) {
          const [meals, diapers, activities] = await Promise.all([
            supabase.from('meal_entries').select('id, daily_log_id').in('daily_log_id', logIds),
            supabase.from('diaper_entries').select('id, daily_log_id').in('daily_log_id', logIds),
            supabase.from('activity_entries').select('id, daily_log_id').in('daily_log_id', logIds),
          ]);
          [...(meals.data || []), ...(diapers.data || []), ...(activities.data || [])]
            .forEach(e => { counts[e.daily_log_id] = (counts[e.daily_log_id] || 0) + 1; });
        }

        const status = {};
        (logs || []).forEach(log => {
          status[log.child_id] = {
            sent: log.sent_to_parents,
            mood: log.moods?.[0],
            entryCount: counts[log.id] || 0,
          };
        });
        setLogStatus(status);
      }
    } else {
      setLogStatus({});
    }

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (isFocused && classroomId) load();
  }, [isFocused, classroomId, dateStr]);

  if (loading) return <LoadingScreen />;

  const moodEmoji = { Happy: '😊', Fussy: '😤', Curious: '🧐', Irritable: '😠', Sleepy: '😴', Sick: '🤒' };

  // Summary counts for header
  const sent    = Object.values(logStatus).filter(s => s.sent).length;
  const started = Object.values(logStatus).filter(s => s.entryCount > 0 && !s.sent).length;
  const empty   = children.length - sent - started;

  function renderChild({ item }) {
    const status    = logStatus[item.id];
    const hasEntries = status?.entryCount > 0;
    const isSent     = status?.sent;
    const napping    = isToday && isNapping(item.id);
    const attStatus  = getAttendanceStatus(item.id); // 'absent' | 'present' | 'departed'

    return (
      <TouchableOpacity
        style={[styles.childCard, attStatus === 'absent' && isToday && styles.childCardAbsent]}
        onPress={() => navigation.navigate('DailyLog', { child: item, date: dateStr })}
        activeOpacity={0.7}
      >
        <View style={styles.childAvatarWrap}>
          <ChildAvatar child={item} size={48} />
          {/* Attendance dot */}
          <View style={[
            styles.attendanceDot,
            attStatus === 'present' && styles.attendanceDotPresent,
            attStatus === 'departed' && styles.attendanceDotDeparted,
          ]} />
        </View>
        <View style={styles.childInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.childName}>{item.first_name} {item.last_name}</Text>
            <AllergyBadge allergies={item.allergies} compact />
          </View>
          <View style={styles.statusRow}>
            {napping ? (
              <View style={styles.napChip}>
                <Text style={styles.napChipText}>😴 {getElapsed(item.id)}</Text>
              </View>
            ) : hasEntries ? (
              <Text style={styles.entryCount}>{status.entryCount} entries</Text>
            ) : (
              <Text style={styles.noEntries}>No entries</Text>
            )}
            {status?.mood && <Text style={styles.moodBadge}>{moodEmoji[status.mood] || '😊'}</Text>}
            {attStatus === 'departed' && <Text style={styles.departedText}>Left for the day</Text>}
          </View>

          {/* Quick-action row (only for today) */}
          {isToday && !isSent && (
            <View style={styles.quickActions}>
              <TouchableOpacity
                style={[
                  styles.quickBtn,
                  attStatus === 'present' && styles.quickBtnPresent,
                  attStatus === 'departed' && styles.quickBtnDeparted,
                ]}
                onPress={() => quickAttendance(item.id, item.first_name)}
                accessibilityLabel={
                  attStatus === 'absent' ? `Check in ${item.first_name}`
                  : attStatus === 'present' ? `Check out ${item.first_name}`
                  : `Check ${item.first_name} back in`
                }
              >
                <Text style={styles.quickBtnText}>
                  {attStatus === 'absent' ? '📍' : attStatus === 'present' ? '✅' : '↩️'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => quickMeal(item.id)}
                accessibilityLabel={`Add meal for ${item.first_name}`}
              >
                <Text style={styles.quickBtnText}>🍽</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickBtn, napping && styles.quickBtnActive]}
                onPress={() => quickNap(item.id, item.first_name)}
                accessibilityLabel={napping ? `End nap for ${item.first_name}` : `Start nap for ${item.first_name}`}
              >
                <Text style={styles.quickBtnText}>😴</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => quickDiaper(item.id)}
                accessibilityLabel={`Add diaper entry for ${item.first_name}`}
              >
                <Text style={styles.quickBtnText}>🩲</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <View style={styles.rightCol}>
          {isSent
            ? <View style={styles.sentBadge}><Text style={styles.sentText}>Sent ✓</Text></View>
            : hasEntries
              ? <View style={styles.draftBadge}><Text style={styles.draftText}>Draft</Text></View>
              : null
          }
          <Text style={styles.chevron}>›</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good {getTimeOfDay()}, {profile?.full_name?.split(' ')[0]} 👋</Text>
          <ClassroomSwitcher />
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{presentCount}/{children.length}</Text>
          <Text style={styles.countLabel}>present</Text>
        </View>
      </View>

      {/* Date navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity onPress={() => setSelectedDate(d => subDays(d, 1))} style={styles.dateBtn}>
          <Text style={styles.dateBtnText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSelectedDate(new Date())} style={styles.dateCenter}>
          <Text style={styles.dateLabel}>{isToday ? 'Today' : format(selectedDate, 'EEE, MMM d')}</Text>
          {!isToday && <Text style={styles.dateTap}>Tap for today</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSelectedDate(d => addDays(d, 1))}
          style={[styles.dateBtn, isToday && { opacity: 0.3 }]}
          disabled={isToday}
        >
          <Text style={styles.dateBtnText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Filter bar */}
      {children.length > 0 && (
        <View style={styles.filterBar}>
          {[
            { key: 'all',     label: 'All',     count: children.length },
            { key: 'pending', label: 'Pending', count: empty + started },
            { key: 'sent',    label: 'Sent',    count: sent },
          ].map(f => (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            >
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
                {f.label} ({f.count})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Search bar */}
      {children.length > 5 && (
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name..."
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
              <Text style={styles.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        data={children.filter(c => {
          // Search filter
          const query = searchQuery.toLowerCase().trim();
          if (query) {
            const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
            if (!fullName.includes(query)) return false;
          }
          // Status filter
          if (filter === 'all') return true;
          const s = logStatus[c.id];
          if (filter === 'sent') return s?.sent;
          if (filter === 'pending') return !s?.sent;
          return true;
        })}
        keyExtractor={c => c.id}
        renderItem={renderChild}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState icon="🏫" message={"No children in your classroom yet.\nGo to Settings → Manage classroom to add them."} />
        }
      />
    </View>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, paddingTop: spacing.xl + spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  greeting: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  date: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  countBadge: {
    backgroundColor: colors.primaryLight, borderRadius: radius.lg,
    padding: spacing.md, alignItems: 'center', minWidth: 60,
  },
  countText: { fontSize: 22, fontWeight: '700', color: colors.primary },
  countLabel: { fontSize: 11, color: colors.primary, fontWeight: '500' },
  dateNav: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  dateBtn: { padding: spacing.md },
  dateBtnText: { fontSize: 20, color: colors.primary, fontWeight: '500' },
  dateCenter: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  dateLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  dateTap: { fontSize: 11, color: colors.primary, marginTop: 2 },
  filterBar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  filterBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: colors.primary, fontWeight: '600' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 40,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
  searchInput: {
    flex: 1, fontSize: 14, color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchClear: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  searchClearText: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
  list: { padding: spacing.lg },
  childCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  childAvatarWrap: {
    marginRight: spacing.md,
    position: 'relative',
  },
  childInfo: { flex: 1 },
  childName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: spacing.sm },
  entryCount: { fontSize: 13, color: colors.textSecondary },
  noEntries: { fontSize: 13, color: colors.textMuted },
  moodBadge: { fontSize: 14 },
  rightCol: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sentBadge: { backgroundColor: colors.successLight, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  sentText: { fontSize: 12, fontWeight: '500', color: colors.success },
  draftBadge: { backgroundColor: colors.amberLight, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  draftText: { fontSize: 12, fontWeight: '500', color: colors.amber },
  chevron: { fontSize: 22, color: colors.textMuted, marginLeft: spacing.xs },

  // Nap timer chip
  napChip: {
    backgroundColor: colors.purpleLight, paddingHorizontal: spacing.sm,
    paddingVertical: 2, borderRadius: radius.full,
  },
  napChipText: { fontSize: 12, color: colors.purple, fontWeight: '600' },

  // Quick-action buttons
  quickActions: {
    flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm,
  },
  quickBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  quickBtnActive: {
    backgroundColor: colors.purpleLight, borderColor: colors.purple,
  },
  quickBtnPresent: {
    backgroundColor: colors.successLight, borderColor: colors.success,
  },
  quickBtnDeparted: {
    backgroundColor: colors.amberLight, borderColor: colors.amber,
  },
  quickBtnText: { fontSize: 14 },

  // Attendance indicators
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  childCardAbsent: { opacity: 0.6 },
  attendanceDot: {
    position: 'absolute', bottom: 0, right: -2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.border,
    borderWidth: 2, borderColor: colors.surface,
  },
  attendanceDotPresent: { backgroundColor: colors.success },
  attendanceDotDeparted: { backgroundColor: colors.amber },
  departedText: { fontSize: 12, color: colors.amber, fontWeight: '500' },
});
