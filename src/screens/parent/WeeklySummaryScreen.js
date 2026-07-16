import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../theme';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, subWeeks, addWeeks, isToday } from 'date-fns';

const MOOD_EMOJI  = { Happy: '😊', Fussy: '😤', Curious: '🧐', Irritable: '😠', Sleepy: '😴', Sick: '🤒' };
const MOOD_COLOR  = {
  Happy:    { bg: colors.successLight,  text: colors.success },
  Fussy:    { bg: colors.dangerLight,   text: colors.danger },
  Curious:  { bg: colors.primaryLight,  text: colors.primary },
  Irritable:{ bg: colors.dangerLight,   text: colors.danger },
  Sleepy:   { bg: colors.purpleLight,   text: colors.purple },
  Sick:     { bg: colors.amberLight,    text: colors.amber },
};

function minutesToDuration(mins) {
  if (!mins || mins <= 0) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? `${mins % 60}m` : ''}`.trim();
}

function calcMins(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

export default function WeeklySummaryScreen({ route }) {
  const { childId, childName } = route.params;
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    loadWeek();
  }, [weekStart, childId]);

  async function loadWeek() {
    setLoading(true);
    const from = format(weekStart, 'yyyy-MM-dd');
    const to   = format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    // Fetch all logs for this week
    const { data: logs } = await supabase
      .from('daily_logs')
      .select('id, log_date, moods, sent_to_parents')
      .eq('child_id', childId)
      .gte('log_date', from)
      .lte('log_date', to)
      .order('log_date');

    if (!logs?.length) { setData(null); setLoading(false); return; }

    const logIds = logs.map(l => l.id);

    // Fetch all entries in parallel
    const [mealsRes, sleepsRes, activitiesRes, diapersRes] = await Promise.all([
      supabase.from('meal_entries').select('*').in('daily_log_id', logIds),
      supabase.from('sleep_entries').select('*').in('daily_log_id', logIds),
      supabase.from('activity_entries').select('*').in('daily_log_id', logIds),
      supabase.from('diaper_entries').select('*').in('daily_log_id', logIds),
    ]);

    const meals      = mealsRes.data      || [];
    const sleeps     = sleepsRes.data     || [];
    const activities = activitiesRes.data || [];
    const diapers    = diapersRes.data    || [];

    // Build a map of logId → log
    const logMap = {};
    logs.forEach(l => { logMap[l.id] = l; });

    // ── Mood frequency
    const moodCount = {};
    logs.forEach(l => (l.moods || []).forEach(m => { moodCount[m] = (moodCount[m] || 0) + 1; }));
    const topMoods = Object.entries(moodCount).sort((a, b) => b[1] - a[1]).slice(0, 3);

    // ── Sleep stats
    const sleepByDay = {};
    sleeps.forEach(s => {
      const date = logMap[s.daily_log_id]?.log_date;
      if (!date) return;
      if (!sleepByDay[date]) sleepByDay[date] = 0;
      sleepByDay[date] += calcMins(s.start_time, s.end_time);
    });
    const sleepValues   = Object.values(sleepByDay).filter(v => v > 0);
    const avgSleepMins  = sleepValues.length ? Math.round(sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length) : 0;
    const totalSleepMins = sleepValues.reduce((a, b) => a + b, 0);

    // ── Meal stats
    const mealAmounts = { all: 0, some: 0, none: 0 };
    meals.forEach(m => { if (mealAmounts[m.amount] !== undefined) mealAmounts[m.amount]++; });
    const totalMeals = meals.length;

    // ── Activity frequency
    const actCount = {};
    activities.forEach(a => { actCount[a.activity_name] = (actCount[a.activity_name] || 0) + 1; });
    const topActivities = Object.entries(actCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // ── Per-day breakdown
    const days = eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) });
    const dayBreakdown = days.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const log     = logs.find(l => l.log_date === dateStr);
      if (!log) return { date: day, dateStr, hasLog: false };

      const dayMeals  = meals.filter(m => m.daily_log_id === log.id);
      const daySleeps = sleeps.filter(s => s.daily_log_id === log.id);
      const sleepMins = daySleeps.reduce((sum, s) => sum + calcMins(s.start_time, s.end_time), 0);

      return {
        date: day, dateStr,
        hasLog: true,
        sent: log.sent_to_parents,
        moods: log.moods || [],
        mealCount: dayMeals.length,
        eatenAll: dayMeals.filter(m => m.amount === 'all').length,
        sleepMins,
      };
    });

    setData({ topMoods, avgSleepMins, totalSleepMins, mealAmounts, totalMeals, topActivities, dayBreakdown, diaperCount: diapers.length });
    setLoading(false);
  }

  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'MMM d, yyyy')}`;
  const isCurrentWeek = format(weekStart, 'yyyy-MM-dd') === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>{childName}'s week</Text>

      {/* Week navigation */}
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => setWeekStart(d => subWeeks(d, 1))} style={styles.weekBtn}>
          <Text style={styles.weekBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.weekLabel}>{weekLabel}</Text>
        <TouchableOpacity
          onPress={() => setWeekStart(d => addWeeks(d, 1))}
          style={[styles.weekBtn, isCurrentWeek && styles.weekBtnDisabled]}
          disabled={isCurrentWeek}
        >
          <Text style={[styles.weekBtnText, isCurrentWeek && { color: colors.border }]}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : !data ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>No logs found for this week.</Text>
        </View>
      ) : (
        <>
          {/* Day strip */}
          <View style={styles.dayStrip}>
            {data.dayBreakdown.map(day => (
              <View key={day.dateStr} style={styles.dayCol}>
                <Text style={styles.dayName}>{format(day.date, 'EEE')}</Text>
                <View style={[
                  styles.dayDot,
                  day.hasLog && day.sent  && styles.dayDotSent,
                  day.hasLog && !day.sent && styles.dayDotDraft,
                ]}>
                  <Text style={styles.dayNum}>{format(day.date, 'd')}</Text>
                </View>
                {day.hasLog && day.moods[0] && (
                  <Text style={styles.dayMood}>{MOOD_EMOJI[day.moods[0]] || ''}</Text>
                )}
              </View>
            ))}
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{minutesToDuration(data.avgSleepMins)}</Text>
              <Text style={styles.statLabel}>Avg. nap</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{data.totalMeals}</Text>
              <Text style={styles.statLabel}>Meals</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{data.diaperCount}</Text>
              <Text style={styles.statLabel}>Diapers</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{minutesToDuration(data.totalSleepMins)}</Text>
              <Text style={styles.statLabel}>Total sleep</Text>
            </View>
          </View>

          {/* Mood breakdown */}
          {data.topMoods.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>😊 Mood this week</Text>
              <View style={styles.moodRow}>
                {data.topMoods.map(([mood, count]) => (
                  <View key={mood} style={[styles.moodChip, { backgroundColor: MOOD_COLOR[mood]?.bg || colors.bg }]}>
                    <Text style={styles.moodEmoji}>{MOOD_EMOJI[mood]}</Text>
                    <Text style={[styles.moodLabel, { color: MOOD_COLOR[mood]?.text || colors.textSecondary }]}>{mood}</Text>
                    <Text style={[styles.moodCount, { color: MOOD_COLOR[mood]?.text || colors.textSecondary }]}>{count}×</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Meals breakdown */}
          {data.totalMeals > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🍽 Meals this week</Text>
              <View style={styles.mealBar}>
                {data.mealAmounts.all > 0 && (
                  <View style={[styles.mealBarFill, { flex: data.mealAmounts.all, backgroundColor: colors.success }]} />
                )}
                {data.mealAmounts.some > 0 && (
                  <View style={[styles.mealBarFill, { flex: data.mealAmounts.some, backgroundColor: colors.amber }]} />
                )}
                {data.mealAmounts.none > 0 && (
                  <View style={[styles.mealBarFill, { flex: data.mealAmounts.none, backgroundColor: colors.danger }]} />
                )}
              </View>
              <View style={styles.mealLegend}>
                <Text style={[styles.mealLegendItem, { color: colors.success }]}>✓ All eaten: {data.mealAmounts.all}</Text>
                <Text style={[styles.mealLegendItem, { color: colors.amber }]}>~ Some: {data.mealAmounts.some}</Text>
                <Text style={[styles.mealLegendItem, { color: colors.danger }]}>✗ None: {data.mealAmounts.none}</Text>
              </View>
            </View>
          )}

          {/* Top activities */}
          {data.topActivities.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🎨 Most common activities</Text>
              {data.topActivities.map(([activity, count]) => (
                <View key={activity} style={styles.actRow}>
                  <Text style={styles.actName}>{activity}</Text>
                  <View style={styles.actBarWrap}>
                    <View style={[styles.actBar, { flex: Math.min(count, 7) }]} />
                    <View style={{ flex: Math.max(7 - count, 0) }} />
                  </View>
                  <Text style={styles.actCount}>{count}×</Text>
                </View>
              ))}
            </View>
          )}

          {/* Daily breakdown */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📅 Day by day</Text>
            {data.dayBreakdown.map(day => (
              <View key={day.dateStr} style={styles.dayRow}>
                <Text style={styles.dayRowDate}>{format(day.date, 'EEE d')}</Text>
                {!day.hasLog ? (
                  <Text style={styles.dayRowEmpty}>No log</Text>
                ) : (
                  <View style={styles.dayRowStats}>
                    {day.moods[0] && <Text>{MOOD_EMOJI[day.moods[0]]}</Text>}
                    <Text style={styles.dayRowStat}>🍽 {day.mealCount}</Text>
                    {day.sleepMins > 0 && <Text style={styles.dayRowStat}>😴 {minutesToDuration(day.sleepMins)}</Text>}
                    {day.sent
                      ? <View style={styles.sentPill}><Text style={styles.sentPillText}>Sent ✓</Text></View>
                      : <View style={styles.draftPill}><Text style={styles.draftPillText}>Draft</Text></View>
                    }
                  </View>
                )}
              </View>
            ))}
          </View>
        </>
      )}

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  weekNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  weekBtn: { padding: spacing.lg },
  weekBtnDisabled: { opacity: 0.3 },
  weekBtnText: { fontSize: 22, color: colors.primary, fontWeight: '500' },
  weekLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  loadingWrap: { paddingTop: 60, alignItems: 'center' },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { fontSize: 15, color: colors.textMuted },
  dayStrip: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  dayCol: { alignItems: 'center', flex: 1 },
  dayName: { fontSize: 11, color: colors.textMuted, fontWeight: '500', marginBottom: 4 },
  dayDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
    marginBottom: 4, borderWidth: 1, borderColor: colors.border,
  },
  dayDotSent:  { backgroundColor: colors.successLight, borderColor: colors.success },
  dayDotDraft: { backgroundColor: colors.amberLight,   borderColor: colors.amber },
  dayNum: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  dayMood: { fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  moodChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  moodEmoji: { fontSize: 16 },
  moodLabel: { fontSize: 13, fontWeight: '500' },
  moodCount: { fontSize: 12, fontWeight: '600' },
  mealBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.border, marginBottom: spacing.sm },
  mealBarFill: { height: '100%' },
  mealLegend: { flexDirection: 'row', gap: spacing.lg },
  mealLegendItem: { fontSize: 12, fontWeight: '500' },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  actName: { fontSize: 13, color: colors.textPrimary, width: 130 },
  actBarWrap: { flex: 1, flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.border },
  actBar: { backgroundColor: colors.purple, height: '100%', borderRadius: 4 },
  actCount: { fontSize: 12, color: colors.textSecondary, width: 24, textAlign: 'right' },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  dayRowDate: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, width: 52 },
  dayRowEmpty: { fontSize: 13, color: colors.textMuted },
  dayRowStats: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  dayRowStat: { fontSize: 13, color: colors.textSecondary },
  sentPill: { backgroundColor: colors.successLight, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  sentPillText: { fontSize: 11, color: colors.success, fontWeight: '500' },
  draftPill: { backgroundColor: colors.amberLight, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  draftPillText: { fontSize: 11, color: colors.amber, fontWeight: '500' },
});
