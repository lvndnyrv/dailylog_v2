import React, { useCallback, useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useDailyLog } from '../../hooks/useDailyLog';
import { useParentFamily } from '../../hooks/useParentFamily';
import { useParentNotifications } from '../../hooks/useParentNotifications';
import { useParentSchedule } from '../../hooks/useParentSchedule';
import { LoadingScreen, Badge, EmptyState, Divider } from '../../components/ui';
import { PhotoSection } from '../../components/PhotoSection';
import { colors, spacing, radius } from '../../theme';
import { format, subDays, addDays, isToday } from 'date-fns';

const MOOD_EMOJI = { Happy: '😊', Fussy: '😤', Curious: '🧐', Irritable: '😠', Sleepy: '😴', Sick: '🤒' };
const AMOUNT_STYLE = {
  all: { color: colors.success, bg: colors.successLight },
  some: { color: colors.amber, bg: colors.amberLight },
  none: { color: colors.danger, bg: colors.dangerLight },
};
const INCIDENT_TONE = {
  minor: { color: colors.amber, backgroundColor: colors.amberLight },
  moderate: { color: colors.coral, backgroundColor: colors.coralLight },
  serious: { color: colors.danger, backgroundColor: colors.dangerLight },
};

// ─── EMPTY STATE with child invite code entry ────────────────────────────────
function LinkChildEmptyState({ onOpen, onLinked }) {
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await onLinked();
    } catch (refreshError) {
      setError(refreshError.message || 'We could not refresh your linked children.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <ScrollView style={emptyStyles.container} contentContainerStyle={emptyStyles.content} keyboardShouldPersistTaps="handled">
      <View style={emptyStyles.iconCircle}>
        <Ionicons name="people-outline" size={31} color={colors.primary} />
      </View>
      <Text style={emptyStyles.title}>Link your child</Text>
      <Text style={emptyStyles.body}>
        Your daycare or co-guardian will send a secure family invitation. You’ll confirm the child before anything is linked.
      </Text>

      <View style={emptyStyles.card}>
        <View style={emptyStyles.cardIcon}>
          <Ionicons name="key-outline" size={21} color={colors.primary} />
        </View>
        <Text style={emptyStyles.cardTitle}>Have an invitation code?</Text>
        <Text style={emptyStyles.cardBody}>Enter it securely, review the child and choose your relationship.</Text>
        {error && <Text style={emptyStyles.errorText}>{error}</Text>}
        <TouchableOpacity
          style={emptyStyles.linkBtn}
          onPress={onOpen}
        >
          <Text style={emptyStyles.linkBtnText}>Enter invitation code</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={handleRefresh} style={emptyStyles.refreshBtn} disabled={refreshing}>
        <Text style={emptyStyles.refreshText}>
          {refreshing ? 'Checking...' : '↻ My daycare already added me — refresh'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const emptyStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: 80, alignItems: 'center' },
  iconCircle: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  body: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    lineHeight: 21, marginBottom: spacing.xl,
  },
  card: {
    alignSelf: 'stretch', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  cardIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  cardBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  errorText: { fontSize: 12, color: colors.danger, fontWeight: '500', marginTop: spacing.xs },
  linkBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md + 2, alignItems: 'center', marginTop: spacing.md,
  },
  linkBtnText: { fontSize: 15, fontWeight: '600', color: colors.white },
  refreshBtn: { marginTop: spacing.xl, padding: spacing.md },
  refreshText: { fontSize: 14, color: colors.primary, fontWeight: '500' },
});

export default function ParentHomeScreen({ navigation, route }) {
  const family = useParentFamily();
  const notifications = useParentNotifications();
  const familySchedule = useParentSchedule();
  const { children, selectedChild } = family;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [pendingIncidents, setPendingIncidents] = useState([]);
  const [attendanceRec, setAttendanceRec] = useState(null);
  const [announcements, setAnnouncements] = useState([]);

  const {
    log, meals, diapers, sleeps, activities, supplies, loading,
    error: logError, refresh: refreshLog,
  } = useDailyLog(selectedChild?.id, selectedDate); // read-only: parents never create logs

  useEffect(() => {
    const requestedChildId = route.params?.childId;
    if (requestedChildId && children.some((child) => child.id === requestedChildId)) {
      family.selectChild(requestedChildId);
    }
    const requestedDate = route.params?.logDate;
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      const parsed = new Date(`${requestedDate}T12:00:00`);
      if (!Number.isNaN(parsed.getTime()) && parsed <= new Date()) setSelectedDate(parsed);
    }
  }, [children, family.selectChild, route.params?.childId, route.params?.logDate]);

  const fetchIncidents = useCallback(async () => {
    if (!selectedChild?.id) { setPendingIncidents([]); return; }
    const { data, error } = await supabase
      .from('incident_reports')
      .select('*')
      .eq('child_id', selectedChild.id)
      .in('status', ['submitted', 'signed_off'])
      .not('parent_notified_at', 'is', null)
      .order('occurred_at', { ascending: false });
    if (error) throw error;
    setPendingIncidents(data || []);
  }, [selectedChild?.id]);

  const fetchAttendance = useCallback(async () => {
    if (!selectedChild?.id) { setAttendanceRec(null); return; }
    const { data, error } = await supabase
      .from('attendance_records')
      .select('checked_in_at, checked_out_at, status, absence_reason, notes, method, absence_report_id')
      .eq('child_id', selectedChild.id)
      .eq('date', format(selectedDate, 'yyyy-MM-dd'))
      .maybeSingle();
    if (error) throw error;
    setAttendanceRec(data || null);
  }, [selectedChild?.id, selectedDate]);

  const fetchAnnouncements = useCallback(async () => {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, body, pinned, created_at, classroom_id')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw error;
    setAnnouncements(data || []);
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      family.refresh({ silent: true }),
      familySchedule.refresh(),
      refreshLog(),
      fetchIncidents(),
      fetchAttendance(),
      fetchAnnouncements(),
    ]);
    setRefreshing(false);
  }, [
    family.refresh,
    familySchedule.refresh,
    fetchAnnouncements,
    fetchAttendance,
    fetchIncidents,
    refreshLog,
  ]);

  useFocusEffect(useCallback(() => {
    refreshAll();
  }, [refreshAll]));

  // Fetch unacknowledged incidents for the selected child
  useEffect(() => {
    fetchIncidents().catch(() => {});

    // Real-time for incidents
    if (!selectedChild?.id) return;
    const channel = supabase
      .channel(`parent-incidents:${selectedChild.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incident_reports',
        filter: `child_id=eq.${selectedChild.id}`,
      }, () => fetchIncidents())
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [fetchIncidents, selectedChild?.id]);

  // Attendance record for the selected child + date
  useEffect(() => {
    fetchAttendance().catch(() => {});
    if (!selectedChild?.id) return undefined;
    const selectedDateString = format(selectedDate, 'yyyy-MM-dd');
    const channel = supabase
      .channel(`parent-attendance:${selectedChild.id}:${selectedDateString}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'attendance_records',
        filter: `child_id=eq.${selectedChild.id}`,
      }, (payload) => {
        const row = payload.new?.id ? payload.new : payload.old;
        if (row?.date === selectedDateString) fetchAttendance().catch(() => {});
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAttendance, selectedChild?.id, selectedDate]);

  // Recent announcements (last 5, newest first — pinned first)
  useEffect(() => {
    fetchAnnouncements().catch(() => {});
    const channel = supabase
      .channel('parent-home-announcements')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'announcements',
      }, () => fetchAnnouncements().catch(() => {}))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAnnouncements]);

  if (family.loading || (selectedChild && loading)) return <LoadingScreen />;

  if (family.error && !children.length) {
    return (
      <View style={styles.loadErrorWrap}>
        <Text style={styles.loadErrorTitle}>We couldn't load your family</Text>
        <Text style={styles.loadErrorText}>{family.error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => family.refresh().catch(() => {})}>
          <Text style={styles.retryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!children.length) {
    return (
      <LinkChildEmptyState
        onOpen={() => navigation.navigate('ParentChildInvite')}
        onLinked={() => family.refresh({ silent: true })}
      />
    );
  }

  const today = isToday(selectedDate);
  const hasMoods = log?.moods?.length > 0;
  const hasContent = meals.length || diapers.length || sleeps.length || activities.length;
  const upcomingClosure = (familySchedule.hub?.closures || [])
    .find((closure) => closure.ends_on >= familySchedule.hub?.today);
  const roomMove = (familySchedule.hub?.room_moves || [])
    .find((plan) => plan.child_id === selectedChild?.id
      && plan.status === 'planned'
      && plan.move_on >= familySchedule.hub?.today);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing || family.refreshing}
          onRefresh={refreshAll}
          tintColor={colors.primary}
        />
      )}>

      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.pageEyebrow}>FAMILY DAILY LOG</Text>
          <Text style={styles.pageTitle}>Today</Text>
        </View>
        <TouchableOpacity
          style={styles.notificationButton}
          onPress={() => navigation.navigate('ParentNotifications')}
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
      </View>

      {(family.error || logError) ? (
        <TouchableOpacity style={styles.inlineError} onPress={refreshAll}>
          <Text style={styles.inlineErrorText}>{family.error || logError} Tap to retry.</Text>
        </TouchableOpacity>
      ) : null}

      {/* Child tabs */}
      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.childTabs} contentContainerStyle={{ gap: spacing.sm }}>
          {children.map(child => (
            <TouchableOpacity
              key={child.id}
              onPress={() => family.selectChild(child)}
              style={[styles.childTab, selectedChild?.id === child.id && styles.childTabSelected]}
            >
              <Text style={[styles.childTabText, selectedChild?.id === child.id && { color: colors.primary }]}>
                {child.first_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Incident alert banner */}
      {pendingIncidents.length > 0 && (
        <View style={styles.incidentBanner}>
          {pendingIncidents.map((incident) => {
            const incidentTone = INCIDENT_TONE[incident.severity] || INCIDENT_TONE.minor;
            return (
              <TouchableOpacity
                key={incident.id}
                style={[styles.incidentAlert, { borderColor: incidentTone.color, backgroundColor: incidentTone.backgroundColor }]}
                onPress={() => navigation.navigate('IncidentDetail', { incident, child: selectedChild })}
                activeOpacity={0.7}
              >
                <Text style={styles.incidentAlertEmoji}>
                  {incident.severity === 'serious' ? '🚨' : incident.severity === 'moderate' ? '⚠️' : '🟡'}
                </Text>
                <View style={styles.incidentAlertContent}>
                  <Text style={[styles.incidentAlertTitle, { color: incidentTone.color }]}>
                    {incident.severity === 'serious' ? 'Serious' : incident.severity === 'moderate' ? 'Moderate' : 'Minor'} incident reported
                  </Text>
                  <Text style={styles.incidentAlertSub}>
                    {incident.injury_type} · {format(new Date(incident.occurred_at), 'h:mm a')} — Tap to review
                  </Text>
                </View>
                <Text style={[styles.incidentAlertChevron, { color: incidentTone.color }]}>›</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Family schedule notices — Admin Groups 11c and 7e */}
      {upcomingClosure ? (
        <TouchableOpacity
          style={[styles.scheduleBanner, styles.closureBanner]}
          onPress={() => navigation.navigate('ParentClosureNotice', { closureId: upcomingClosure.id })}
          activeOpacity={0.75}
          accessibilityRole="button"
        >
          <Text style={styles.scheduleIcon}>🗓️</Text>
          <View style={styles.scheduleCopy}>
            <Text style={styles.scheduleEyebrow}>CENTER CLOSURE</Text>
            <Text style={styles.scheduleTitle}>{upcomingClosure.reason}</Text>
            <Text style={styles.scheduleBody}>
              {format(new Date(`${upcomingClosure.starts_on}T12:00:00`), 'EEEE, MMMM d')} · See closure details
            </Text>
          </View>
          <Text style={styles.scheduleChevron}>›</Text>
        </TouchableOpacity>
      ) : null}

      {roomMove ? (
        <TouchableOpacity
          style={[styles.scheduleBanner, styles.moveBanner]}
          onPress={() => navigation.navigate('ParentRoomMove', {
            transitionId: roomMove.id,
            childId: roomMove.child_id,
          })}
          activeOpacity={0.75}
          accessibilityRole="button"
        >
          <Text style={styles.scheduleIcon}>🎒</Text>
          <View style={styles.scheduleCopy}>
            <Text style={styles.scheduleEyebrow}>ROOM MOVE PLAN</Text>
            <Text style={styles.scheduleTitle}>
              {selectedChild.first_name} is moving to {roomMove.to_room_name}
            </Text>
            <Text style={styles.scheduleBody}>
              Move day {format(new Date(`${roomMove.move_on}T12:00:00`), 'MMM d')} · See the transition plan
            </Text>
          </View>
          <Text style={styles.scheduleChevron}>›</Text>
        </TouchableOpacity>
      ) : null}

      {/* Date navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity onPress={() => setSelectedDate(d => subDays(d, 1))} style={styles.dateBtn}>
          <Text style={styles.dateBtnText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.dateCentre}>
          <Text style={styles.dateLabel}>
            {today ? 'Today' : format(selectedDate, 'EEEE')}
          </Text>
          <Text style={styles.dateSubLabel}>{format(selectedDate, 'MMMM d, yyyy')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setSelectedDate(d => addDays(d, 1))}
          style={[styles.dateBtn, today && styles.dateBtnDisabled]}
          disabled={today}
        >
          <Text style={[styles.dateBtnText, today && { color: colors.border }]}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Announcements */}
      {announcements.length > 0 && (
        <TouchableOpacity
          style={styles.annCard}
          onPress={() => navigation.navigate('Announcements')}
          activeOpacity={0.8}
        >
          <Text style={styles.annTitle}>📢 Announcements</Text>
          {announcements.map((a, i) => (
            <View key={a.id}>
              {i > 0 && <Divider />}
              <View style={styles.annRow}>
                {a.pinned && <Text style={styles.annPin}>📌</Text>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.annRowTitle}>{a.title}</Text>
                  <Text style={styles.annRowBody} numberOfLines={3}>{a.body}</Text>
                  <Text style={styles.annRowDate}>{format(new Date(a.created_at), 'MMM d, h:mm a')}</Text>
                </View>
              </View>
            </View>
          ))}
        </TouchableOpacity>
      )}

      {/* Header card */}
      <View style={styles.heroCard}>
        <View>
          <Text style={styles.heroName}>{selectedChild?.first_name}'s day</Text>
          {log?.sent_to_parents
            ? <Badge label="Log sent ✓" color={colors.success} bg={colors.successLight} />
            : today
              ? <Badge label="In progress..." color={colors.amber} bg={colors.amberLight} />
              : <Badge label="Not filled" color={colors.textMuted} bg={colors.bg} />
          }
          {/* Attendance times */}
          {attendanceRec?.checked_in_at && (
            <Text style={styles.attendanceText}>
              📍 Arrived {format(new Date(attendanceRec.checked_in_at), 'h:mm a')}
              {attendanceRec.checked_out_at && ` · Left ${format(new Date(attendanceRec.checked_out_at), 'h:mm a')}`}
            </Text>
          )}
          {attendanceRec?.status === 'absent' && (
            <Text style={styles.absenceText}>
              🗓️ Absent · {attendanceRec.absence_reason
                ? attendanceRec.absence_reason.charAt(0).toUpperCase() + attendanceRec.absence_reason.slice(1)
                : 'Reported'}
            </Text>
          )}
        </View>
        {hasMoods && (
          <Text style={styles.moodDisplay}>
            {log.moods.map(m => MOOD_EMOJI[m] || '').join(' ')}
          </Text>
        )}
      </View>

      {/* Quick actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, attendanceRec?.status === 'absent' && styles.actionBtnHighlighted]}
          onPress={() => navigation.navigate('ReportAbsence', { child: selectedChild })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>🗓️</Text>
          <Text style={styles.actionText}>
            {attendanceRec?.absence_report_id ? 'Manage absence' : 'Report absence'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, pendingIncidents.length > 0 && styles.incidentActionHighlighted]}
          onPress={() => navigation.navigate('ParentIncidents', { child: selectedChild, childId: selectedChild?.id })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>🩹</Text>
          <Text style={styles.actionText}>
            {pendingIncidents.length ? `Review incident${pendingIncidents.length > 1 ? 's' : ''}` : 'Incident reports'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('WeeklySummary', {
            childId: selectedChild?.id,
            childName: selectedChild?.first_name,
          })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>📊</Text>
          <Text style={styles.actionText}>Weekly summary</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Messaging', {
            childId: selectedChild?.id,
            childName: selectedChild?.first_name,
          })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionText}>Message educator</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('PickupPass', {
            child: selectedChild,
          })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>🔐</Text>
          <Text style={styles.actionText}>Pickup pass</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Medication', {
            child: selectedChild,
          })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>💊</Text>
          <Text style={styles.actionText}>Medications</Text>
        </TouchableOpacity>
      </View>

      {!hasContent && !hasMoods ? (
        <EmptyState icon="📋" message={today ? "No entries yet today.\nCheck back later!" : "No log was filled for this day."} />
      ) : (
        <>
          {/* Mood */}
          {hasMoods && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>😊  Today's mood</Text>
              <View style={styles.moodRow}>
                {log.moods.map(m => (
                  <View key={m} style={styles.moodChip}>
                    <Text style={styles.moodEmoji}>{MOOD_EMOJI[m]}</Text>
                    <Text style={styles.moodLabel}>{m}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Meals */}
          {meals.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🍽  Meals</Text>
              {meals.map((meal, i) => (
                <View key={meal.id}>
                  {i > 0 && <Divider />}
                  <View style={styles.mealRow}>
                    <Text style={styles.mealTime}>{meal.time?.substring(0, 5)}</Text>
                    <Text style={styles.mealFood}>{meal.food_type}</Text>
                    <Badge
                      label={meal.amount}
                      color={AMOUNT_STYLE[meal.amount]?.color}
                      bg={AMOUNT_STYLE[meal.amount]?.bg}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Sleep */}
          {sleeps.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>😴  Sleep</Text>
              {sleeps.map(s => {
                const duration = s.end_time
                  ? calcDuration(s.start_time, s.end_time)
                  : 'still napping';
                return (
                  <View key={s.id} style={styles.sleepRow}>
                    <Text style={styles.sleepTime}>{s.start_time?.substring(0, 5)} – {s.end_time?.substring(0, 5) || '...'}</Text>
                    <Text style={styles.sleepDuration}>{duration}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Diapers */}
          {diapers.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🩲  Diaper / toilet</Text>
              {diapers.map((d, i) => (
                <View key={d.id}>
                  {i > 0 && <Divider />}
                  <View style={styles.diaperRow}>
                    <Text style={styles.mealTime}>{d.time?.substring(0, 5)}</Text>
                    <Badge label={d.type} color={colors.textSecondary} bg={colors.bg} />
                    {d.wet && <Badge label="Wet" color={colors.purple} bg={colors.purpleLight} />}
                    {d.bm && <Badge label="BM" color={colors.amber} bg={colors.amberLight} />}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Activities */}
          {activities.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🎨  Activities</Text>
              <View style={styles.activityWrap}>
                {activities.map(a => (
                  <View key={a.id} style={styles.activityChip}>
                    <Text style={styles.activityText}>{a.activity_name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Supplies */}
          {supplies.length > 0 && (
            <View style={[styles.card, styles.supplyCard]}>
              <Text style={[styles.cardTitle, { color: colors.danger }]}>📦  Please bring more</Text>
              <View style={styles.activityWrap}>
                {supplies.map(s => (
                  <View key={s.id} style={styles.supplyChip}>
                    <Text style={styles.supplyText}>{s.item_name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Notes */}
          {(log?.notes || log?.comments) && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📝  Notes from the educator</Text>
              {log.notes ? <Text style={styles.noteText}>{log.notes}</Text> : null}
              {log.comments ? <Text style={styles.noteText}>{log.comments}</Text> : null}
            </View>
          )}

          {/* Photos */}
          {log && <PhotoSection logId={log.id} childId={selectedChild?.id} readOnly={true} />}
        </>
      )}

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

function calcDuration(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins < startMins) endMins += 24 * 60;
  const mins = endMins - startMins;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  pageHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  pageEyebrow: { color: colors.textFaint, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },
  pageTitle: { marginTop: 2, color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  notificationButton: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
  },
  notificationBadge: {
    position: 'absolute', top: -3, right: -3, minWidth: 19, height: 19,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 2, borderColor: colors.bg, backgroundColor: colors.danger,
  },
  notificationBadgeText: { color: colors.white, fontSize: 9, fontWeight: '700' },
  loadErrorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.xxl,
  },
  loadErrorTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  loadErrorText: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  retryButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  inlineError: {
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: `${colors.danger}44`,
    borderRadius: radius.md,
    backgroundColor: colors.dangerLight,
    padding: spacing.md,
  },
  inlineErrorText: { color: colors.danger, fontSize: 12.5, lineHeight: 18, fontWeight: '500' },
  childTabs: { marginBottom: spacing.md },
  childTab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  childTabSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  childTabText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateBtn: { padding: spacing.lg },
  dateBtnDisabled: { opacity: 0.3 },
  dateBtnText: { fontSize: 22, color: colors.primary, fontWeight: '500' },
  dateCentre: { flex: 1, alignItems: 'center' },
  dateLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  dateSubLabel: { fontSize: 12, color: colors.textSecondary },
  heroCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '33',
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: {
    flexGrow: 1, flexBasis: '46%', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center', gap: spacing.xs,
  },
  actionBtnHighlighted: { borderColor: colors.amber, backgroundColor: colors.amberLight },
  incidentActionHighlighted: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  actionIcon: { fontSize: 22 },
  actionText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500', textAlign: 'center' },
  heroName: { fontSize: 20, fontWeight: '700', color: colors.primaryDark, marginBottom: spacing.xs },
  moodDisplay: { fontSize: 32 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  supplyCard: { borderColor: colors.danger + '44' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  moodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moodEmoji: { fontSize: 16 },
  moodLabel: { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  mealTime: { fontSize: 13, color: colors.textSecondary, width: 46, fontWeight: '500' },
  mealFood: { flex: 1, fontSize: 14, color: colors.textPrimary },
  sleepRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  sleepTime: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  sleepDuration: { fontSize: 13, color: colors.textSecondary },
  diaperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  activityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  activityChip: {
    backgroundColor: colors.purpleLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.full,
  },
  activityText: { fontSize: 13, color: colors.purple, fontWeight: '500' },
  supplyChip: {
    backgroundColor: colors.dangerLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.full,
  },
  supplyText: { fontSize: 13, color: colors.danger, fontWeight: '500' },
  noteText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20, marginBottom: spacing.sm },
  incidentBanner: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  incidentAlert: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.dangerLight, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1.5, borderColor: colors.danger,
  },
  incidentAlertEmoji: { fontSize: 22 },
  incidentAlertContent: { flex: 1 },
  incidentAlertTitle: { fontSize: 14, fontWeight: '600', color: colors.danger },
  incidentAlertSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  incidentAlertChevron: { fontSize: 22, color: colors.danger },

  // Announcements
  annCard: {
    backgroundColor: colors.amberLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.amber + '44',
    padding: spacing.lg, marginBottom: spacing.md,
  },
  annTitle: { fontSize: 15, fontWeight: '700', color: colors.amber, marginBottom: spacing.sm },
  annRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  annPin: { fontSize: 14 },
  annRowTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  annRowBody: { fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  annRowDate: { fontSize: 11, color: colors.textMuted, marginTop: 4 },

  // Attendance
  attendanceText: { fontSize: 12, color: colors.primaryDark, marginTop: spacing.sm, fontWeight: '500' },
  absenceText: { fontSize: 12, color: colors.amber, marginTop: spacing.sm, fontWeight: '700' },
  scheduleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.lg, borderWidth: 1.5,
    padding: spacing.md, marginBottom: spacing.md,
  },
  closureBanner: { backgroundColor: '#FFFDF8', borderColor: '#EFD9B5' },
  moveBanner: { backgroundColor: colors.primaryLight, borderColor: `${colors.primary}33` },
  scheduleIcon: { fontSize: 25 },
  scheduleCopy: { flex: 1, minWidth: 0 },
  scheduleEyebrow: {
    color: colors.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 0.6,
  },
  scheduleTitle: {
    color: colors.textPrimary, fontSize: 14.5, fontWeight: '700', marginTop: 2,
  },
  scheduleBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  scheduleChevron: { color: colors.textFaint, fontSize: 24 },
});
