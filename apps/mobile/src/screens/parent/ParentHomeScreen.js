import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { ActivityIndicator, View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useDailyLog } from '../../hooks/useDailyLog';
import { useParentFamily } from '../../hooks/useParentFamily';
import { useParentNotifications } from '../../hooks/useParentNotifications';
import { useParentSchedule } from '../../hooks/useParentSchedule';
import { LoadingScreen, Badge, Divider } from '../../components/ui';
import { PhotoSection } from '../../components/PhotoSection';
import { colors, spacing, radius } from '../../theme';
import { format, subDays, addDays, isToday } from 'date-fns';

const MOOD_PRESENTATION = {
  Happy: { icon: 'happy-outline', color: colors.success, background: colors.successLight },
  Fussy: { icon: 'thunderstorm-outline', color: colors.coral, background: colors.coralLight },
  Curious: { icon: 'bulb-outline', color: colors.primary, background: colors.primaryLight },
  Irritable: { icon: 'alert-circle-outline', color: colors.danger, background: colors.dangerLight },
  Sleepy: { icon: 'moon-outline', color: colors.purple, background: colors.purpleLight },
  Sick: { icon: 'medical-outline', color: colors.amber, background: colors.amberLight },
};
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

function moodPresentation(mood) {
  return MOOD_PRESENTATION[mood] || {
    icon: 'ellipse-outline', color: colors.textMuted, background: colors.primarySoft,
  };
}

function normalizeTimelineTime(value, fallback) {
  if (!value && fallback) return normalizeTimelineTime(fallback);
  if (!value) return { label: '', sortKey: '' };
  if (value.includes('T')) {
    const date = new Date(value);
    return {
      label: Number.isNaN(date.getTime()) ? '' : format(date, 'h:mm a'),
      sortKey: Number.isNaN(date.getTime()) ? '' : format(date, 'HH:mm:ss'),
    };
  }
  return { label: value.slice(0, 5), sortKey: value };
}

function buildTimelineEntries({ log, attendance, meals, sleeps, diapers, activities }) {
  const items = [];
  if (log?.moods?.length) {
    const mood = moodPresentation(log.moods[0]);
    const time = attendance?.checked_in_at
      ? normalizeTimelineTime(attendance.checked_in_at)
      : { label: 'Drop-off', sortKey: log.created_at };
    items.push({
      id: `mood-${log.id}`,
      icon: mood.icon,
      tone: mood.color,
      title: log.moods.join(' & '),
      detail: 'Mood at drop-off',
      ...time,
    });
  }
  meals.forEach((meal) => {
    items.push({
      id: `meal-${meal.id}`,
      icon: 'restaurant-outline',
      tone: meal.amount === 'none' ? colors.danger : meal.amount === 'some' ? colors.amber : colors.success,
      title: meal.food_type,
      detail: meal.amount === 'all' ? 'Ate all' : meal.amount === 'some' ? 'Ate some' : 'Did not eat',
      ...normalizeTimelineTime(meal.time, meal.created_at),
    });
  });
  sleeps.forEach((sleep) => {
    items.push({
      id: `sleep-${sleep.id}`,
      icon: 'moon-outline',
      tone: colors.purple,
      title: sleep.end_time ? `Nap · ${calcDuration(sleep.start_time, sleep.end_time)}` : 'Nap in progress',
      detail: sleep.end_time ? `Woke at ${sleep.end_time.slice(0, 5)}` : 'We will update when they wake',
      ...normalizeTimelineTime(sleep.start_time, sleep.created_at),
    });
  });
  diapers.forEach((diaper) => {
    const details = [diaper.type === 'toilet' ? 'Toilet' : 'Diaper', diaper.wet && 'wet', diaper.bm && 'BM'].filter(Boolean);
    items.push({
      id: `care-${diaper.id}`,
      icon: 'water-outline',
      tone: colors.primary,
      title: details.join(' · '),
      detail: 'Care check',
      ...normalizeTimelineTime(diaper.time, diaper.created_at),
    });
  });
  activities.forEach((activity) => {
    items.push({
      id: `activity-${activity.id}`,
      icon: 'color-palette-outline',
      tone: colors.purple,
      title: activity.activity_name,
      detail: 'Learning & play',
      ...normalizeTimelineTime(activity.created_at),
    });
  });
  return items.sort((left, right) => right.sortKey.localeCompare(left.sortKey));
}

function DailyTimeline({ entries }) {
  return (
    <View style={styles.timelineCard}>
      {entries.map((entry, index) => (
        <View key={entry.id}>
          {index === 0 ? <Text style={styles.timelineSection}>LATEST</Text> : index === 1 ? <Text style={styles.timelineSection}>EARLIER TODAY</Text> : null}
          <View style={styles.timelineRow}>
            <View style={[styles.timelineIcon, { backgroundColor: `${entry.tone}18` }]}>
              <Ionicons name={entry.icon} size={18} color={entry.tone} />
            </View>
            <View style={styles.timelineCopy}>
              <Text style={styles.timelineTitle}>{entry.title}</Text>
              <Text style={styles.timelineDetail}>{entry.detail}</Text>
            </View>
            <Text style={styles.timelineTime}>{entry.label}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function GlanceMetric({ icon, color = colors.textFaint, label }) {
  return (
    <View style={styles.glanceItem}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.glanceValue}>{label}</Text>
    </View>
  );
}

function CardSectionTitle({ icon, title, color = colors.primary, background = colors.primarySoft, titleColor = colors.textPrimary }) {
  return (
    <View style={styles.cardTitleRow}>
      <View style={[styles.cardTitleIcon, { backgroundColor: background }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={[styles.cardTitle, { color: titleColor }]}>{title}</Text>
    </View>
  );
}

function ParentToolRow({
  icon,
  iconColor = colors.primary,
  iconBackground = colors.primarySoft,
  title,
  subtitle,
  badge,
  badgeTone = 'primary',
  onPress,
  isLast = false,
}) {
  const badgeStyle = badgeTone === 'danger'
    ? styles.toolBadgeDanger
    : badgeTone === 'amber'
      ? styles.toolBadgeAmber
      : styles.toolBadgePrimary;

  return (
    <TouchableOpacity
      style={[styles.toolRow, isLast && styles.toolRowLast]}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={[styles.toolIcon, { backgroundColor: iconBackground }]}>
        <Ionicons name={icon} size={19} color={iconColor} />
      </View>
      <View style={styles.toolCopy}>
        <Text style={styles.toolTitle}>{title}</Text>
        <Text style={styles.toolSubtitle} numberOfLines={2}>{subtitle}</Text>
      </View>
      {badge ? (
        <View style={[styles.toolBadge, badgeStyle]}>
          <Text style={[styles.toolBadgeText, badgeTone === 'danger' && styles.toolBadgeTextDanger]}>{badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

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
  const [dayView, setDayView] = useState('timeline');

  const {
    log, meals, diapers, sleeps, activities, supplies, loading,
    error: logError, refresh: refreshLog,
  } = useDailyLog(selectedChild?.id, selectedDate); // read-only: parents never create logs

  useEffect(() => {
    const requestedChildId = route.params?.childId;
    if (requestedChildId && children.some((child) => child.id === requestedChildId)) {
      family.selectChild(requestedChildId);
    }
  }, [children, family.selectChild, route.params?.childId]);

  useEffect(() => {
    const requestedDate = route.params?.logDate;
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      const parsed = new Date(`${requestedDate}T12:00:00`);
      if (!Number.isNaN(parsed.getTime()) && parsed <= new Date()) {
        setSelectedDate((currentDate) => (
          format(currentDate, 'yyyy-MM-dd') === requestedDate ? currentDate : parsed
        ));
      }
    }
  }, [route.params?.logDate]);

  const fetchIncidents = useCallback(async () => {
    if (!selectedChild?.id) { setPendingIncidents([]); return; }
    const { data, error } = await supabase
      .from('incident_reports')
      .select('id, child_id, occurred_at, location, severity, injury_type, description, status, parent_notified_at, parent_acknowledged_at')
      .eq('child_id', selectedChild.id)
      .in('status', ['submitted', 'signed_off'])
      .not('parent_notified_at', 'is', null)
      .is('parent_acknowledged_at', null)
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
    // useDailyLog already performs its own initial/date load. Starting a
    // second identical five-query load here can leave the newer request
    // waiting behind the first one on mobile connections.
    Promise.allSettled([
      family.refresh({ silent: true }),
      familySchedule.refresh(),
      fetchIncidents(),
      fetchAttendance(),
      fetchAnnouncements(),
    ]);
  }, [
    family.refresh,
    familySchedule.refresh,
    fetchAnnouncements,
    fetchAttendance,
    fetchIncidents,
  ]));

  // Fetch unacknowledged incidents for the selected child
  useEffect(() => {
    fetchIncidents().catch(() => {});

    // Real-time for incidents
    if (!selectedChild?.id) return;
    const channelInstance = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`parent-incidents:${selectedChild.id}:${channelInstance}`)
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
    const channelInstance = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`parent-attendance:${selectedChild.id}:${selectedDateString}:${channelInstance}`)
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
    const channelInstance = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`parent-home-announcements:${channelInstance}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'announcements',
      }, () => fetchAnnouncements().catch(() => {}))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAnnouncements]);

  const timelineEntries = useMemo(() => buildTimelineEntries({
    log,
    attendance: attendanceRec,
    meals,
    sleeps,
    diapers,
    activities,
  }), [activities, attendanceRec, diapers, log, meals, sleeps]);

  const totalNapMinutes = useMemo(() => sleeps.reduce((total, sleep) => {
    if (!sleep.end_time) return total;
    const label = calcDuration(sleep.start_time, sleep.end_time);
    const hours = Number(label.match(/(\d+)h/)?.[1] || 0);
    const minutes = Number(label.match(/(\d+)m/)?.[1] || 0);
    return total + (hours * 60) + minutes;
  }, 0), [sleeps]);

  if (family.loading) return <LoadingScreen />;

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
  const hasContent = Boolean(meals.length || diapers.length || sleeps.length || activities.length);
  const absent = ['absent', 'excused'].includes(attendanceRec?.status);
  const complete = Boolean(log?.sent_to_parents);
  const awaitingRecap = Boolean(attendanceRec?.checked_out_at && !complete && !absent);
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
          <Text style={styles.pageTitle}>{today ? 'Today' : format(selectedDate, 'EEEE')}</Text>
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
                <View style={[styles.incidentAlertIcon, { backgroundColor: colors.surface }]}>
                  <Ionicons
                    name={incident.severity === 'serious' ? 'alert-circle-outline' : incident.severity === 'moderate' ? 'warning-outline' : 'medkit-outline'}
                    size={20}
                    color={incidentTone.color}
                  />
                </View>
                <View style={styles.incidentAlertContent}>
                  <Text style={[styles.incidentAlertTitle, { color: incidentTone.color }]}>
                    {incident.severity === 'serious' ? 'Serious' : incident.severity === 'moderate' ? 'Moderate' : 'Minor'} incident reported
                  </Text>
                  <Text style={styles.incidentAlertSub}>
                    {incident.injury_type} · {format(new Date(incident.occurred_at), 'h:mm a')} — Tap to review
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={incidentTone.color} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Family schedule notices — Admin Groups 11c and 7e */}
      {today && upcomingClosure ? (
        <TouchableOpacity
          style={[styles.scheduleBanner, styles.closureBanner]}
          onPress={() => navigation.navigate('ParentClosureNotice', { closureId: upcomingClosure.id })}
          activeOpacity={0.75}
          accessibilityRole="button"
        >
          <View style={[styles.scheduleIcon, styles.closureIcon]}>
            <Ionicons name="calendar-outline" size={20} color={colors.amber} />
          </View>
          <View style={styles.scheduleCopy}>
            <Text style={styles.scheduleEyebrow}>CENTER CLOSURE</Text>
            <Text style={styles.scheduleTitle}>{upcomingClosure.reason}</Text>
            <Text style={styles.scheduleBody}>
              {format(new Date(`${upcomingClosure.starts_on}T12:00:00`), 'EEEE, MMMM d')} · See closure details
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </TouchableOpacity>
      ) : null}

      {today && roomMove ? (
        <TouchableOpacity
          style={[styles.scheduleBanner, styles.moveBanner]}
          onPress={() => navigation.navigate('ParentRoomMove', {
            transitionId: roomMove.id,
            childId: roomMove.child_id,
          })}
          activeOpacity={0.75}
          accessibilityRole="button"
        >
          <View style={[styles.scheduleIcon, styles.moveIcon]}>
            <Ionicons name="school-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.scheduleCopy}>
            <Text style={styles.scheduleEyebrow}>ROOM MOVE PLAN</Text>
            <Text style={styles.scheduleTitle}>
              {selectedChild.first_name} is moving to {roomMove.to_room_name}
            </Text>
            <Text style={styles.scheduleBody}>
              Move day {format(new Date(`${roomMove.move_on}T12:00:00`), 'MMM d')} · See the transition plan
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
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
      {today && announcements.length > 0 && (
        <TouchableOpacity
          style={styles.annCard}
          onPress={() => navigation.navigate('Announcements')}
          activeOpacity={0.8}
        >
          <View style={styles.annTitleRow}>
            <View style={styles.annTitleIcon}>
              <Ionicons name="megaphone-outline" size={18} color={colors.amber} />
            </View>
            <Text style={styles.annTitle}>Announcements</Text>
          </View>
          {announcements.slice(0, 1).map((a, i) => (
            <View key={a.id}>
              {i > 0 && <Divider />}
              <View style={styles.annRow}>
                {a.pinned ? (
                  <View style={styles.annPin}>
                    <Ionicons name="pin-outline" size={16} color={colors.amber} />
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.annRowTitle}>{a.title}</Text>
                  <Text style={styles.annRowBody} numberOfLines={3}>{a.body}</Text>
                  <Text style={styles.annRowDate}>{format(new Date(a.created_at), 'MMM d, h:mm a')}</Text>
                </View>
              </View>
            </View>
          ))}
          {announcements.length > 1 ? (
            <Text style={styles.annMore}>View {announcements.length - 1} more announcement{announcements.length === 2 ? '' : 's'} →</Text>
          ) : null}
        </TouchableOpacity>
      )}

      {/* Header card */}
      <View style={styles.heroCard}>
        <View style={styles.heroCopy}>
          <Text style={styles.heroName}>{selectedChild?.first_name}'s day</Text>
          {absent
            ? <Badge label="Away today" color={colors.amber} bg={colors.amberLight} />
            : complete
              ? <Badge label="Day complete ✓" color={colors.success} bg={colors.successLight} />
              : awaitingRecap
                ? <Badge label="Recap being prepared" color={colors.amber} bg={colors.amberLight} />
              : attendanceRec?.checked_in_at
                ? <Badge label="In preschool" color={colors.success} bg={colors.successLight} />
                : log
                  ? <Badge label="In progress..." color={colors.amber} bg={colors.amberLight} />
                  : today
                    ? <Badge label="Waiting for check-in" color={colors.textMuted} bg={colors.bg} />
                    : <Badge label="No update" color={colors.textMuted} bg={colors.bg} />
          }
          {/* Attendance times */}
          {attendanceRec?.checked_in_at && (
            <View style={styles.attendanceLine}>
              <Ionicons name="location-outline" size={15} color={colors.primaryDark} />
              <Text style={styles.attendanceText}>
                Arrived {format(new Date(attendanceRec.checked_in_at), 'h:mm a')}
                {attendanceRec.checked_out_at && ` · Left ${format(new Date(attendanceRec.checked_out_at), 'h:mm a')}`}
              </Text>
            </View>
          )}
          {attendanceRec?.status === 'absent' && (
            <View style={styles.attendanceLine}>
              <Ionicons name="calendar-outline" size={15} color={colors.amber} />
              <Text style={styles.absenceText}>
                Absent · {attendanceRec.absence_reason
                  ? attendanceRec.absence_reason.charAt(0).toUpperCase() + attendanceRec.absence_reason.slice(1)
                  : 'Reported'}
              </Text>
            </View>
          )}
        </View>
        {hasMoods ? (
          <View style={[styles.heroMood, { backgroundColor: moodPresentation(log.moods[0]).background }]}>
            <Ionicons
              name={moodPresentation(log.moods[0]).icon}
              size={25}
              color={moodPresentation(log.moods[0]).color}
            />
          </View>
        ) : null}
      </View>

      {complete && !absent ? (
        <TouchableOpacity
          style={styles.recapButton}
          onPress={() => navigation.navigate('ParentDayRecap', {
            childId: selectedChild?.id,
            childName: selectedChild?.first_name,
            logDate: format(selectedDate, 'yyyy-MM-dd'),
          })}
        >
          <View style={styles.recapIcon}><Ionicons name="document-text-outline" size={19} color={colors.primary} /></View>
          <View style={styles.recapCopy}>
            <Text style={styles.recapTitle}>Daily recap is ready</Text>
            <Text style={styles.recapBody}>See the completed day and share a concise summary.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </TouchableOpacity>
      ) : null}

      {loading ? (
        <View style={styles.dayLoadingCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.dayLoadingText}>Loading this day's updates…</Text>
        </View>
      ) : !hasContent && !hasMoods ? (
        <View style={[styles.dayStateCard, absent && styles.dayStateAbsent]}>
          <View style={[styles.dayStateIcon, absent && { backgroundColor: colors.amberLight }]}>
            <Ionicons
              name={absent ? 'calendar-outline' : attendanceRec?.checked_in_at ? 'sunny-outline' : 'time-outline'}
              size={27}
              color={absent ? colors.amber : colors.primary}
            />
          </View>
          <Text style={styles.dayStateTitle}>
            {absent
              ? `${selectedChild?.first_name} is away today`
              : awaitingRecap
                ? 'The daily recap is being prepared'
              : attendanceRec?.checked_in_at
                ? 'The day is just getting started'
                : today
                  ? 'Waiting for check-in'
                  : 'No daily update for this day'}
          </Text>
          <Text style={styles.dayStateBody}>
            {absent
              ? 'The absence is recorded. No classroom updates are expected.'
              : awaitingRecap
                ? 'Pickup is complete. The educator is reviewing the final report and will send it shortly.'
              : attendanceRec?.checked_in_at
                ? 'The educator will add meals, naps, care and activities as they happen.'
                : today
                  ? 'Updates will appear here after the center checks your child in.'
                  : 'There is no attendance or classroom log available.'}
          </Text>
          {today && !absent ? (
            <TouchableOpacity style={styles.dayStateAction} onPress={() => navigation.navigate('Messaging', { childId: selectedChild?.id, childName: selectedChild?.first_name })}>
              <Text style={styles.dayStateActionText}>Message the classroom</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.glanceCard}>
            <GlanceMetric
              icon={hasMoods ? moodPresentation(log.moods[0]).icon : 'remove-outline'}
              color={hasMoods ? moodPresentation(log.moods[0]).color : colors.textFaint}
              label={hasMoods ? log.moods[0] : 'No mood'}
            />
            <View style={styles.glanceDivider} />
            <GlanceMetric icon="restaurant-outline" label={`${meals.length} meal${meals.length === 1 ? '' : 's'}`} />
            <View style={styles.glanceDivider} />
            <GlanceMetric
              icon="moon-outline"
              label={totalNapMinutes ? calcMinutesLabel(totalNapMinutes) : sleeps.some((sleep) => !sleep.end_time) ? 'Napping' : 'No nap'}
            />
            <View style={styles.glanceDivider} />
            <GlanceMetric icon="water-outline" label={`${diapers.length} care`} />
          </View>

          <View style={styles.dayViewToggle}>
            {[
              { key: 'timeline', label: 'Timeline' },
              { key: 'details', label: 'Details' },
            ].map((option) => (
              <TouchableOpacity
                key={option.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: dayView === option.key }}
                onPress={() => setDayView(option.key)}
                style={[styles.dayViewOption, dayView === option.key && styles.dayViewOptionActive]}
              >
                <Text style={[styles.dayViewText, dayView === option.key && styles.dayViewTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {dayView === 'timeline' ? <DailyTimeline entries={timelineEntries} /> : (
            <>
          {/* Mood */}
          {hasMoods && (
            <View style={styles.card}>
              <CardSectionTitle icon="happy-outline" title="Today's mood" color={colors.success} background={colors.successLight} />
              <View style={styles.moodRow}>
                {log.moods.map((m) => {
                  const mood = moodPresentation(m);
                  return (
                    <View key={m} style={[styles.moodChip, { backgroundColor: mood.background }]}>
                      <Ionicons name={mood.icon} size={16} color={mood.color} />
                      <Text style={styles.moodLabel}>{m}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Meals */}
          {meals.length > 0 && (
            <View style={styles.card}>
              <CardSectionTitle icon="restaurant-outline" title="Meals" />
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
              <CardSectionTitle icon="moon-outline" title="Sleep" color={colors.purple} background={colors.purpleLight} />
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
              <CardSectionTitle icon="water-outline" title="Diaper / toilet" />
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
              <CardSectionTitle icon="color-palette-outline" title="Activities" color={colors.purple} background={colors.purpleLight} />
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
              <CardSectionTitle icon="cube-outline" title="Please bring more" color={colors.danger} background={colors.dangerLight} titleColor={colors.danger} />
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
              <CardSectionTitle icon="document-text-outline" title="Notes from the educator" />
              {log.notes ? <Text style={styles.noteText}>{log.notes}</Text> : null}
              {log.comments ? <Text style={styles.noteText}>{log.comments}</Text> : null}
            </View>
          )}

          {/* Photos */}
          {log && <PhotoSection logId={log.id} childId={selectedChild?.id} readOnly={true} />}
            </>
          )}
        </>
      )}

      {/* Secondary actions stay below the daily story so care updates remain primary. */}
      <Text style={styles.actionsHeading}>MORE FOR {selectedChild?.first_name?.toUpperCase()}</Text>
      <View style={styles.toolsCard}>
        <ParentToolRow
          icon="calendar-outline"
          iconColor={attendanceRec?.status === 'absent' ? colors.amber : colors.primary}
          iconBackground={attendanceRec?.status === 'absent' ? colors.amberLight : colors.primarySoft}
          title={attendanceRec?.absence_report_id ? 'Manage absence' : 'Report absence'}
          subtitle={attendanceRec?.absence_report_id
            ? 'Review or update the absence already reported'
            : `Let the classroom know ${selectedChild?.first_name || 'your child'} will be away`}
          badge={attendanceRec?.status === 'absent' ? 'Reported' : null}
          badgeTone="amber"
          onPress={() => navigation.navigate('ReportAbsence', { child: selectedChild })}
        />
        <ParentToolRow
          icon="medkit-outline"
          iconColor={pendingIncidents.length ? colors.danger : colors.amber}
          iconBackground={pendingIncidents.length ? colors.dangerLight : colors.amberLight}
          title={pendingIncidents.length ? `Review incident${pendingIncidents.length > 1 ? 's' : ''}` : 'Incident reports'}
          subtitle={pendingIncidents.length
            ? `${pendingIncidents.length} report${pendingIncidents.length > 1 ? 's need' : ' needs'} your acknowledgement`
            : 'View reports, care notes and signed records'}
          badge={pendingIncidents.length ? String(pendingIncidents.length) : null}
          badgeTone="danger"
          onPress={() => navigation.navigate('ParentIncidents', { child: selectedChild, childId: selectedChild?.id })}
        />
        <ParentToolRow
          icon="chatbubble-ellipses-outline"
          title="Message educator"
          subtitle={`Chat securely with ${selectedChild?.first_name || 'your child'}’s classroom`}
          onPress={() => navigation.navigate('Messaging', { childId: selectedChild?.id, childName: selectedChild?.first_name })}
        />
        <ParentToolRow
          icon="bar-chart-outline"
          iconColor={colors.purple}
          iconBackground={colors.purpleLight}
          title="Weekly summary"
          subtitle="See routines, highlights and attendance at a glance"
          onPress={() => navigation.navigate('WeeklySummary', { childId: selectedChild?.id, childName: selectedChild?.first_name })}
        />
        <ParentToolRow
          icon="key-outline"
          iconColor={colors.success}
          iconBackground={colors.successLight}
          title="Pickup pass"
          subtitle="Open your secure pass for an authorized pickup"
          onPress={() => navigation.navigate('PickupPass', { child: selectedChild })}
        />
        <ParentToolRow
          icon="medical-outline"
          iconColor={colors.coral}
          iconBackground={colors.coralLight}
          title="Medications"
          subtitle="Manage authorizations and review dose history"
          onPress={() => navigation.navigate('Medication', { child: selectedChild })}
          isLast
        />
      </View>

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

function calcMinutesLabel(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const remainder = minutes % 60;
  return `${Math.floor(minutes / 60)}h${remainder ? ` ${remainder}m` : ''}`;
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
  heroCopy: { flex: 1, minWidth: 0 },
  heroMood: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md,
  },
  recapButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
  },
  recapIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  recapCopy: { flex: 1 },
  recapTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  recapBody: { color: colors.textMuted, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  actionsHeading: { color: colors.textFaint, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.9, marginTop: spacing.sm, marginBottom: spacing.sm },
  toolsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  toolRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    paddingVertical: spacing.md,
  },
  toolRowLast: { borderBottomWidth: 0 },
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolCopy: { flex: 1, minWidth: 0 },
  toolTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  toolSubtitle: { color: colors.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  toolBadge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  toolBadgePrimary: { backgroundColor: colors.primaryLight },
  toolBadgeAmber: { backgroundColor: colors.amberLight },
  toolBadgeDanger: { backgroundColor: colors.dangerLight },
  toolBadgeText: { color: colors.amber, fontSize: 10.5, fontWeight: '700' },
  toolBadgeTextDanger: { color: colors.danger },
  heroName: { fontSize: 20, fontWeight: '700', color: colors.primaryDark, marginBottom: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  supplyCard: { borderColor: colors.danger + '44' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  cardTitleIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
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
  dayLoadingCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.xl, marginBottom: spacing.md },
  dayLoadingText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  dayStateCard: { alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.xxl, marginBottom: spacing.md },
  dayStateAbsent: { borderColor: '#ECD4A5' },
  dayStateIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  dayStateTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '700', textAlign: 'center' },
  dayStateBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: spacing.sm },
  dayStateAction: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.lg },
  dayStateActionText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  glanceCard: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md, marginBottom: spacing.md },
  glanceItem: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  glanceValue: { color: colors.textSecondary, fontSize: 9.5, fontWeight: '600', textAlign: 'center', marginTop: 5 },
  glanceDivider: { width: 1, backgroundColor: colors.borderSoft },
  dayViewToggle: { flexDirection: 'row', backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 4, marginBottom: spacing.md },
  dayViewOption: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm },
  dayViewOptionActive: { backgroundColor: colors.surface },
  dayViewText: { color: colors.textMuted, fontSize: 12.5, fontWeight: '700' },
  dayViewTextActive: { color: colors.primary },
  timelineCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, marginBottom: spacing.md },
  timelineSection: { color: colors.textFaint, fontSize: 9.5, fontWeight: '700', letterSpacing: 1, paddingTop: spacing.md, paddingBottom: spacing.xs },
  timelineRow: { flexDirection: 'row', alignItems: 'center', minHeight: 68, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  timelineIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  timelineCopy: { flex: 1, minWidth: 0 },
  timelineTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  timelineDetail: { color: colors.textMuted, fontSize: 11.5, marginTop: 2 },
  timelineTime: { color: colors.textFaint, fontSize: 10.5, fontWeight: '600', marginLeft: spacing.sm },
  incidentBanner: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  incidentAlert: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.dangerLight, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1.5, borderColor: colors.danger,
  },
  incidentAlertIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  incidentAlertContent: { flex: 1 },
  incidentAlertTitle: { fontSize: 14, fontWeight: '600', color: colors.danger },
  incidentAlertSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  // Announcements
  annCard: {
    backgroundColor: colors.amberLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.amber + '44',
    padding: spacing.lg, marginBottom: spacing.md,
  },
  annTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  annTitleIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  annTitle: { fontSize: 15, fontWeight: '700', color: colors.amber },
  annRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  annPin: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  annRowTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  annRowBody: { fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  annRowDate: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  annMore: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: spacing.md },

  // Attendance
  attendanceLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  attendanceText: { flex: 1, fontSize: 12, color: colors.primaryDark, fontWeight: '500' },
  absenceText: { flex: 1, fontSize: 12, color: colors.amber, fontWeight: '700' },
  scheduleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.lg, borderWidth: 1.5,
    padding: spacing.md, marginBottom: spacing.md,
  },
  closureBanner: { backgroundColor: '#FFFDF8', borderColor: '#EFD9B5' },
  moveBanner: { backgroundColor: colors.primaryLight, borderColor: `${colors.primary}33` },
  scheduleIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  closureIcon: { backgroundColor: colors.amberLight },
  moveIcon: { backgroundColor: colors.surface },
  scheduleCopy: { flex: 1, minWidth: 0 },
  scheduleEyebrow: {
    color: colors.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 0.6,
  },
  scheduleTitle: {
    color: colors.textPrimary, fontSize: 14.5, fontWeight: '700', marginTop: 2,
  },
  scheduleBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
});
