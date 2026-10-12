import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useDailyLog } from '../../hooks/useDailyLog';
import { PhotoSection } from '../../components/PhotoSection';
import { colors, fonts, radius, spacing } from '../../theme';

const MOOD_EMOJI = { Happy: '😊', Fussy: '😤', Curious: '🧐', Irritable: '😠', Sleepy: '😴', Sick: '🤒', Calm: '🌿' };

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let minutes = ((endHour * 60) + endMinute) - ((startHour * 60) + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

function durationLabel(minutes) {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return `${hours}h${remainder ? ` ${remainder}m` : ''}`;
}

function Metric({ icon, value, label }) {
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export default function ParentDayRecapScreen({ navigation, route }) {
  const { childId, childName, logDate } = route.params || {};
  const day = useMemo(() => {
    const parsed = new Date(`${logDate}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [logDate]);
  const { log, meals, diapers, sleeps, activities, supplies, loading, error, refresh } = useDailyLog(childId, day);
  const [attendance, setAttendance] = useState(null);
  const [resolvedChildName, setResolvedChildName] = useState('');
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAttendance = useCallback(async () => {
    if (!childId) return;
    setAttendanceLoading(true);
    const [result, childResult] = await Promise.all([
      supabase
        .from('attendance_records')
        .select('checked_in_at, checked_out_at, status, absence_reason, notes')
        .eq('child_id', childId)
        .eq('date', format(day, 'yyyy-MM-dd'))
        .maybeSingle(),
      supabase.from('children').select('first_name').eq('id', childId).maybeSingle(),
    ]);
    if (!result.error) setAttendance(result.data || null);
    if (!childResult.error) setResolvedChildName(childResult.data?.first_name || '');
    setAttendanceLoading(false);
  }, [childId, day]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);

  const napMinutes = sleeps.reduce((total, sleep) => total + minutesBetween(sleep.start_time, sleep.end_time), 0);
  const attendedMinutes = attendance?.checked_in_at && attendance?.checked_out_at
    ? Math.max(0, Math.round((new Date(attendance.checked_out_at) - new Date(attendance.checked_in_at)) / 60000))
    : 0;
  const careEntries = meals.length + diapers.length + sleeps.length + activities.length;
  const absent = ['absent', 'excused'].includes(attendance?.status);
  const displayChildName = childName || resolvedChildName || 'Your child';

  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.allSettled([refresh(), loadAttendance()]);
    setRefreshing(false);
  };

  const shareRecap = async () => {
    const mood = log?.moods?.[0] ? ` Mood: ${log.moods[0]}.` : '';
    const attendanceText = attendedMinutes ? ` Attended for ${durationLabel(attendedMinutes)}.` : '';
    await Share.share({
      title: `${displayChildName}'s daily recap`,
      message: `${displayChildName}'s recap for ${format(day, 'MMMM d, yyyy')}.${attendanceText}${mood} ${meals.length} meal${meals.length === 1 ? '' : 's'}, ${durationLabel(napMinutes)} nap time, and ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} recorded.`,
    });
  };

  if (loading || attendanceLoading) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.iconButton}>
          <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>DAILY RECAP</Text>
          <Text style={styles.title}>{format(day, 'EEEE, MMMM d')}</Text>
        </View>
        <TouchableOpacity accessibilityLabel="Share daily recap" disabled={!log?.sent_to_parents || absent} onPress={shareRecap} style={styles.iconButton}>
          <Ionicons name="share-outline" size={20} color={log?.sent_to_parents && !absent ? colors.primary : colors.textFaint} />
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {absent ? (
        <View style={[styles.hero, styles.absentHero]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.amberLight }]}>
            <Ionicons name="calendar-outline" size={28} color={colors.amber} />
          </View>
          <Text style={styles.heroTitle}>{displayChildName} was away</Text>
          <Text style={styles.heroBody}>
            {attendance?.absence_reason
              ? `${attendance.absence_reason[0].toUpperCase()}${attendance.absence_reason.slice(1)}`
              : 'The center recorded an absence for this day.'}
          </Text>
          {attendance?.notes ? <Text style={styles.note}>{attendance.notes}</Text> : null}
        </View>
      ) : log && !log.sent_to_parents ? (
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="time-outline" size={28} color={colors.primary} /></View>
          <Text style={styles.heroTitle}>The final recap is being prepared</Text>
          <Text style={styles.heroBody}>Live updates remain available on Today. The educator will review and send the completed report soon.</Text>
        </View>
      ) : !log && !attendance ? (
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="document-text-outline" size={28} color={colors.primary} /></View>
          <Text style={styles.heroTitle}>No update for this day</Text>
          <Text style={styles.heroBody}>There is no attendance or daily log to summarize.</Text>
        </View>
      ) : (
        <>
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.eyebrow}>{log?.sent_to_parents ? 'FINAL REPORT' : 'DAY IN PROGRESS'}</Text>
                <Text style={styles.heroTitle}>{displayChildName}'s day at a glance</Text>
              </View>
              <Text style={styles.moods}>{(log?.moods || []).map((mood) => MOOD_EMOJI[mood] || '•').join(' ')}</Text>
            </View>
            {attendance?.checked_in_at ? (
              <Text style={styles.heroBody}>
                {format(new Date(attendance.checked_in_at), 'h:mm a')} arrival
                {attendance.checked_out_at ? ` · ${format(new Date(attendance.checked_out_at), 'h:mm a')} pickup` : ''}
              </Text>
            ) : null}
          </View>

          <View style={styles.metrics}>
            <Metric icon="time-outline" value={durationLabel(attendedMinutes)} label="At center" />
            <Metric icon="restaurant-outline" value={String(meals.length)} label="Meals" />
            <Metric icon="moon-outline" value={durationLabel(napMinutes)} label="Nap time" />
            <Metric icon="sparkles-outline" value={String(careEntries)} label="Updates" />
          </View>

          {log?.moods?.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Mood</Text>
              <Text style={styles.cardBody}>{log.moods.map((mood) => `${MOOD_EMOJI[mood] || ''} ${mood}`).join('   ')}</Text>
            </View>
          ) : null}

          {meals.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Meals</Text>
              {meals.map((meal) => <Text key={meal.id} style={styles.rowText}>{meal.time?.slice(0, 5)} · {meal.food_type} · {meal.amount}</Text>)}
            </View>
          ) : null}

          {sleeps.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sleep</Text>
              {sleeps.map((sleep) => (
                <Text key={sleep.id} style={styles.rowText}>
                  {sleep.start_time?.slice(0, 5)}–{sleep.end_time?.slice(0, 5) || 'still sleeping'} · {durationLabel(minutesBetween(sleep.start_time, sleep.end_time))}
                </Text>
              ))}
            </View>
          ) : null}

          {activities.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Learning & play</Text>
              <View style={styles.chips}>
                {activities.map((activity) => <Text key={activity.id} style={styles.chip}>{activity.activity_name}</Text>)}
              </View>
            </View>
          ) : null}

          {diapers.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Care checks</Text>
              {diapers.map((diaper) => (
                <Text key={diaper.id} style={styles.rowText}>
                  {diaper.time?.slice(0, 5)} · {diaper.type}{diaper.wet ? ' · wet' : ''}{diaper.bm ? ' · BM' : ''}
                </Text>
              ))}
            </View>
          ) : null}

          {(log?.notes || log?.comments) ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>A note from the educator</Text>
              <Text style={styles.cardBody}>{[log.notes, log.comments].filter(Boolean).join('\n\n')}</Text>
            </View>
          ) : null}

          {supplies.length ? (
            <View style={[styles.card, styles.supplyCard]}>
              <Text style={styles.cardTitle}>Please bring</Text>
              <Text style={styles.cardBody}>{supplies.map((item) => item.item_name).join(', ')}</Text>
            </View>
          ) : null}

          {log ? <PhotoSection logId={log.id} childId={childId} readOnly /> : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 48 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  headerCopy: { flex: 1, paddingHorizontal: spacing.md },
  iconButton: { width: 42, height: 42, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.textFaint, fontFamily: fonts.black, fontSize: 10, letterSpacing: 1 },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21, marginTop: 2 },
  error: { color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  hero: { backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: `${colors.primary}33`, borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.md },
  absentHero: { alignItems: 'center', backgroundColor: colors.surface, borderColor: '#ECD4A5', paddingVertical: spacing.xxl },
  heroIcon: { width: 58, height: 58, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, marginBottom: spacing.md },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroCopy: { flex: 1 },
  heroTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20, marginTop: 4 },
  heroBody: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  moods: { fontSize: 25 },
  note: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: spacing.md, textAlign: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  metric: { width: '48%', flexGrow: 1, minHeight: 88, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  metricValue: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18, marginTop: 4 },
  metricLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  supplyCard: { borderColor: `${colors.danger}44`, backgroundColor: colors.dangerLight },
  cardTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15, marginBottom: spacing.sm },
  cardBody: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  rowText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { color: colors.purple, backgroundColor: colors.purpleLight, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fonts.bold, fontSize: 12 },
});
