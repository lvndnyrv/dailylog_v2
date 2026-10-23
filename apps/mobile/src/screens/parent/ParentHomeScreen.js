import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { ActivityIndicator, View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { listLocalizedAnnouncements } from '../../lib/localizedAnnouncements';
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

function FamilyAction({ icon, title, subtitle, tone = colors.primary, background = '#EDF4FC', badge, onPress }) {
  return (
    <TouchableOpacity
      style={styles.familyAction}
      onPress={onPress}
      activeOpacity={0.76}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={styles.actionTopline}>
        <View style={[styles.actionIcon, { backgroundColor: background }]}><Ionicons name={icon} size={21} color={tone} /></View>
        {badge ? <View style={styles.actionBadge}><Text style={styles.actionBadgeText}>{badge}</Text></View> : <Ionicons name="arrow-forward" size={15} color={colors.textFaint} />}
      </View>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionSubtitle} numberOfLines={2}>{subtitle}</Text>
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

  useEffect(() => {
    if (!route.params?.linkedAt) return;
    refreshLog().catch(() => {});
  }, [refreshLog, route.params?.linkedAt]);

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
    setAnnouncements(await listLocalizedAnnouncements(20));
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        family.refresh({ silent: true }),
        familySchedule.refresh(),
        refreshLog(),
        fetchIncidents(),
        fetchAttendance(),
        fetchAnnouncements(),
      ]);
    } finally {
      setRefreshing(false);
    }
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

  // Fetch enough to find a current update even when older posts are pinned.
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
  const recentAnnouncements = announcements.filter((announcement) => {
    const publishedAt = Date.parse(announcement.created_at);
    return Number.isFinite(publishedAt) && publishedAt >= Date.now() - (30 * 24 * 60 * 60 * 1000);
  });
  const firstName = selectedChild?.first_name || 'Your child';
  const statusLabel = absent ? 'Away today'
    : complete ? 'Day complete'
      : awaitingRecap ? 'Recap on its way'
        : attendanceRec?.checked_in_at ? 'At the center'
          : log ? 'A day in progress'
            : today ? 'Waiting for check-in' : 'No update for this day';
  const statusIcon = absent ? 'home-outline'
    : complete ? 'checkmark-circle-outline'
      : attendanceRec?.checked_in_at ? 'heart-outline' : 'time-outline';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refreshAll}
          tintColor={colors.primary}
        />
      )}>

      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.pageEyebrow}>A LITTLE WINDOW INTO THEIR WORLD</Text>
          <Text style={styles.pageTitle}>{today ? 'Today with ' : `${format(selectedDate, 'EEEE')} with `}{firstName}</Text>
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

      {/* A child-first opening, with attendance as supporting context. */}
      <View style={styles.heroCard}>
        <View style={styles.heroDecoration} />
        <View style={styles.heroTopline}>
          <View style={styles.heroAvatar}><Text style={styles.heroAvatarText}>{firstName.charAt(0).toUpperCase()}</Text></View>
          <View style={styles.heroDateTag}><Ionicons name="sunny-outline" size={15} color={colors.amber} /><Text style={styles.heroDateText}>{format(selectedDate, 'MMMM d')}</Text></View>
        </View>
        <Text style={styles.heroName}>A day of little moments</Text>
        <Text style={styles.heroIntro}>
          {absent ? 'A quiet day at home. We hope to see you soon.'
            : attendanceRec?.checked_in_at ? 'Follow the little moments as they happen.'
              : complete ? 'The day is wrapped up and ready to revisit.'
                : 'Meals, play and moments from the classroom, all in one place.'}
        </Text>
        <View style={styles.heroStatus}>
          <Ionicons name={statusIcon} size={17} color={colors.primaryDark} />
          <Text style={styles.heroStatusText}>{statusLabel}</Text>
        </View>
        <View style={styles.heroCopy}>
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
      </View>

      <View style={styles.dateNav}>
        <TouchableOpacity onPress={() => setSelectedDate(d => subDays(d, 1))} style={styles.dateBtn} accessibilityRole="button" accessibilityLabel="Previous day">
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.dateCentre}>
          <Text style={styles.dateLabel}>{today ? 'Today' : format(selectedDate, 'EEEE')}</Text>
          <Text style={styles.dateSubLabel}>{format(selectedDate, 'EEEE, MMMM d, yyyy')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setSelectedDate(d => addDays(d, 1))}
          style={[styles.dateBtn, today && styles.dateBtnDisabled]}
          disabled={today}
          accessibilityRole="button"
          accessibilityLabel="Next day"
        >
          <Ionicons name="chevron-forward" size={18} color={today ? colors.textFaint : colors.primary} />
        </TouchableOpacity>
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

      <View style={styles.sectionHeadingRow}>
        <View><Text style={styles.sectionEyebrow}>THE DAILY STORY</Text><Text style={styles.sectionHeading}>Little moments</Text></View>
        {hasMoods ? <View style={[styles.sectionMood, { backgroundColor: moodPresentation(log.moods[0]).background }]}><Ionicons name={moodPresentation(log.moods[0]).icon} size={20} color={moodPresentation(log.moods[0]).color} /></View> : null}
      </View>
      {loading ? (
        <View style={styles.dayLoadingCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.dayLoadingText}>Loading this day's updates…</Text>
        </View>
      ) : !hasContent && !hasMoods ? (
        <View style={styles.storyEmptyCard}>
          <View style={styles.storyEmptyArt}>
            <View style={styles.storySun}><Ionicons name={absent ? 'home-outline' : 'sunny-outline'} size={32} color={colors.amber} /></View>
            <View style={styles.storyHill} />
          </View>
          <Text style={styles.storyEmptyTitle}>{absent ? 'A day to rest at home' : awaitingRecap ? 'A recap is on its way' : attendanceRec?.checked_in_at ? 'The first moments are on their way' : today ? 'Their story starts soon' : 'No moments shared this day'}</Text>
          <Text style={styles.storyEmptyBody}>{absent ? 'There won’t be classroom notes today.' : awaitingRecap ? 'Your educator is putting together the day’s final notes.' : attendanceRec?.checked_in_at ? 'When the classroom shares a meal, photo or activity, it will appear here.' : today ? `Once ${firstName} checks in, you’ll find their meals, play and rest here.` : 'There are no classroom updates for this date.'}</Text>
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

      {today && (upcomingClosure || roomMove || recentAnnouncements.length > 0) ? (
        <View style={styles.familyNewsSection}>
          <Text style={styles.sectionEyebrow}>LIFE BEYOND TODAY</Text>
          <Text style={styles.sectionHeading}>Around {firstName}</Text>
          {roomMove ? <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${firstName} is moving to ${roomMove.to_room_name}. View the transition plan`}
            activeOpacity={0.76}
            style={[styles.featureCard, styles.moveFeature]}
            onPress={() => navigation.navigate('ParentRoomMove', { transitionId: roomMove.id, childId: roomMove.child_id })}
          >
            <View style={styles.featureIcon}><Ionicons name="school-outline" size={24} color={colors.primary} /></View>
            <View style={styles.featureCopy}><Text style={styles.featureEyebrow}>A NEW CHAPTER</Text><Text style={styles.featureTitle}>{firstName} is moving to {roomMove.to_room_name}</Text><Text style={styles.featureDetail}>Let’s get ready together · {format(new Date(`${roomMove.move_on}T12:00:00`), 'MMM d')}</Text></View>
            <Ionicons name="arrow-forward" size={19} color={colors.primary} />
          </TouchableOpacity> : null}
          {upcomingClosure ? <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${upcomingClosure.reason}. View closure details`}
            activeOpacity={0.76}
            style={[styles.featureCard, styles.closureFeature]}
            onPress={() => navigation.navigate('ParentClosureNotice', { closureId: upcomingClosure.id })}
          >
            <View style={[styles.featureIcon, styles.closureFeatureIcon]}><Ionicons name="calendar-outline" size={22} color={colors.amber} /></View>
            <View style={styles.featureCopy}><Text style={[styles.featureEyebrow, styles.closureEyebrow]}>A DAY TO PLAN FOR</Text><Text style={styles.featureTitle}>{upcomingClosure.reason}</Text><Text style={styles.featureDetail}>The center will be closed · {format(new Date(`${upcomingClosure.starts_on}T12:00:00`), 'MMM d')}</Text></View>
            <Ionicons name="arrow-forward" size={19} color={colors.amber} />
          </TouchableOpacity> : null}
          {recentAnnouncements.length > 0 ? <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`News from your center: ${recentAnnouncements[0].title}`}
            activeOpacity={0.76}
            style={styles.newsCard}
            onPress={() => navigation.navigate('Announcements', { announcementId: recentAnnouncements[0].id })}
          >
            <View style={styles.newsIcon}><Ionicons name="megaphone-outline" size={21} color={colors.amber} /></View>
            <View style={styles.featureCopy}><Text style={styles.newsEyebrow}>NEWS FROM THE CENTER</Text><Text style={styles.newsTitle}>{recentAnnouncements[0].title}</Text><Text style={styles.newsMore}>{recentAnnouncements.length > 1 ? `Read this and ${recentAnnouncements.length - 1} more` : 'Read the announcement'}  →</Text></View>
          </TouchableOpacity> : null}
        </View>
      ) : null}

      <View style={styles.servicesHeading}><Text style={styles.sectionEyebrow}>HERE WHEN YOU NEED THEM</Text><Text style={styles.sectionHeading}>For {firstName}</Text></View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Message ${firstName}'s educator`}
        activeOpacity={0.76}
        style={styles.messageFeature}
        onPress={() => navigation.navigate('Messaging', { childId: selectedChild?.id, childName: selectedChild?.first_name })}
      >
        <View style={styles.messageIcon}><Ionicons name="chatbubble-ellipses-outline" size={24} color={colors.success} /></View>
        <View style={styles.featureCopy}><Text style={styles.messageTitle}>Talk to the classroom</Text><Text style={styles.messageDetail}>A question about {firstName}'s day? Send a message.</Text></View>
        <Ionicons name="arrow-forward" size={19} color={colors.success} />
      </TouchableOpacity>
      <View style={styles.actionsGrid}>
        <FamilyAction
          icon="calendar-outline"
          tone={colors.amber}
          background={colors.amberLight}
          title={attendanceRec?.absence_report_id ? 'Manage absence' : 'Report absence'}
          subtitle={attendanceRec?.absence_report_id ? 'Update a day away' : 'Let the classroom know'}
          badge={attendanceRec?.status === 'absent' ? 'Reported' : null}
          onPress={() => navigation.navigate('ReportAbsence', { child: selectedChild })}
        />
        <FamilyAction
          icon="medkit-outline"
          tone={pendingIncidents.length ? colors.danger : colors.amber}
          background={pendingIncidents.length ? colors.dangerLight : colors.amberLight}
          title={pendingIncidents.length ? `Review incident${pendingIncidents.length > 1 ? 's' : ''}` : 'Incident reports'}
          subtitle={pendingIncidents.length ? 'Needs your acknowledgement' : 'Reports and care notes'}
          badge={pendingIncidents.length ? String(pendingIncidents.length) : null}
          onPress={() => navigation.navigate('ParentIncidents', { child: selectedChild, childId: selectedChild?.id })}
        />
        <FamilyAction
          icon="bar-chart-outline"
          tone={colors.purple}
          background={colors.purpleLight}
          title="The week in review"
          subtitle="Highlights and routines"
          onPress={() => navigation.navigate('WeeklySummary', { childId: selectedChild?.id, childName: selectedChild?.first_name })}
        />
        <FamilyAction
          icon="qr-code-outline"
          tone={colors.primary}
          title="Door attendance pass"
          subtitle="Scan at drop-off or pickup"
          onPress={() => navigation.navigate('FamilyAttendancePass', { child: selectedChild })}
        />
        <FamilyAction
          icon="key-outline"
          tone={colors.success}
          background={colors.successLight}
          title="Pickup pass"
          subtitle="Your authorized pickup code"
          onPress={() => navigation.navigate('PickupPass', { child: selectedChild })}
        />
        <FamilyAction
          icon="medical-outline"
          tone={colors.coral}
          background={colors.coralLight}
          title="Medications"
          subtitle="Authorizations and doses"
          onPress={() => navigation.navigate('Medication', { child: selectedChild })}
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
  container: { flex: 1, backgroundColor: '#F7F9F7' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  pageHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pageEyebrow: { color: colors.success, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  pageTitle: { marginTop: 4, color: colors.textPrimary, fontSize: 27, fontWeight: '800', letterSpacing: -0.7 },
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
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    marginBottom: spacing.xl,
    borderWidth: 1, borderColor: '#E5EBE9',
  },
  dateBtn: { width: 54, height: 58, alignItems: 'center', justifyContent: 'center' },
  dateBtnDisabled: { opacity: 0.3 },
  dateCentre: { flex: 1, alignItems: 'center' },
  dateLabel: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  dateSubLabel: { fontSize: 11, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
  heroCard: {
    backgroundColor: '#FFF1DF',
    borderRadius: 28,
    padding: spacing.xl,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1, borderColor: '#F2DDBC',
  },
  heroDecoration: { position: 'absolute', width: 170, height: 170, borderRadius: 85, top: -74, right: -32, backgroundColor: '#FFE5B9' },
  heroTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  heroAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#F4C981' },
  heroAvatarText: { color: colors.amber, fontSize: 23, fontWeight: '800' },
  heroDateTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFFFFAA', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 99 },
  heroDateText: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  heroName: { color: colors.textPrimary, fontSize: 21, fontWeight: '800', letterSpacing: -0.5 },
  heroIntro: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 5, marginBottom: spacing.md },
  heroStatus: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 },
  heroStatusText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  heroCopy: { marginTop: 2 },
  recapButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
  },
  recapIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  recapCopy: { flex: 1 },
  recapTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  recapBody: { color: colors.textMuted, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: spacing.md },
  sectionEyebrow: { color: colors.success, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.3, marginBottom: 3 },
  sectionHeading: { color: colors.textPrimary, fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  sectionMood: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  storyEmptyCard: { backgroundColor: '#FFFFFF', borderRadius: 24, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg, alignItems: 'center', borderWidth: 1, borderColor: '#E5EBE9', marginBottom: spacing.xl },
  storyEmptyArt: { width: '100%', height: 80, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: spacing.sm },
  storySun: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF1D8', alignItems: 'center', justifyContent: 'center', marginTop: -5 },
  storyHill: { position: 'absolute', width: 200, height: 48, borderRadius: 100, backgroundColor: '#DDEFE4', bottom: -43 },
  storyEmptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  storyEmptyBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: spacing.xs },
  familyNewsSection: { marginBottom: spacing.xl },
  featureCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: 20, marginTop: spacing.md, borderWidth: 1 },
  moveFeature: { backgroundColor: '#E9F2FB', borderColor: '#C9DEF2' },
  closureFeature: { backgroundColor: '#FFF6E8', borderColor: '#F4DFC0' },
  featureIcon: { width: 47, height: 47, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  closureFeatureIcon: { backgroundColor: '#FFFDF8' },
  featureCopy: { flex: 1, minWidth: 0 },
  featureEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: colors.primary, marginBottom: 3 },
  closureEyebrow: { color: colors.amber },
  featureTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800', color: colors.textPrimary },
  featureDetail: { fontSize: 11, lineHeight: 16, color: colors.textSecondary, marginTop: 4 },
  newsCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: 20, marginTop: spacing.md, borderWidth: 1, borderColor: '#E5EBE9', backgroundColor: '#FFFFFF' },
  newsIcon: { width: 45, height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF3E1' },
  newsEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: colors.amber, marginBottom: 3 },
  newsTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  newsMore: { fontSize: 11, fontWeight: '700', color: colors.primary, marginTop: 5 },
  servicesHeading: { marginBottom: spacing.md },
  messageFeature: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: 20, backgroundColor: '#E7F4EB', borderWidth: 1, borderColor: '#CEE8D7', marginBottom: spacing.md },
  messageIcon: { width: 47, height: 47, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  messageTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  messageDetail: { fontSize: 11, lineHeight: 16, color: colors.textSecondary, marginTop: 3 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  familyAction: { width: '48%', minHeight: 128, padding: spacing.md, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5EBE9' },
  actionTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  actionIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  actionBadge: { minWidth: 21, height: 21, borderRadius: 11, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  actionBadgeText: { color: colors.danger, fontSize: 10, fontWeight: '800' },
  actionTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  actionSubtitle: { color: colors.textMuted, fontSize: 10.5, lineHeight: 14, marginTop: 3 },
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

  updatesCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  updatesHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.xs },
  updatesHeading: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  updatesCount: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  updateRow: { flexDirection: 'row', alignItems: 'center', minHeight: 66, gap: spacing.md, paddingVertical: spacing.sm },
  updateRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  updateIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  updateCopy: { flex: 1, minWidth: 0 },
  updateTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  updateDetail: { color: colors.textMuted, fontSize: 11, marginTop: 3 },

  // Attendance
  attendanceLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  attendanceText: { flex: 1, fontSize: 12, color: colors.primaryDark, fontWeight: '500' },
  absenceText: { flex: 1, fontSize: 12, color: colors.amber, fontWeight: '700' },
});
