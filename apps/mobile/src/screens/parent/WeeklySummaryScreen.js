import React, { useCallback, useMemo, useState } from 'react';
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  isAfter,
  startOfDay,
  startOfWeek,
  subWeeks,
} from 'date-fns';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const MOOD_META = {
  Happy: { icon: 'happy-outline', bg: colors.successLight, color: colors.success },
  Curious: { icon: 'bulb-outline', bg: colors.primaryLight, color: colors.primary },
  Sleepy: { icon: 'moon-outline', bg: colors.purpleLight, color: colors.purple },
  Fussy: { icon: 'rainy-outline', bg: colors.dangerLight, color: colors.danger },
  Irritable: { icon: 'alert-circle-outline', bg: colors.dangerLight, color: colors.danger },
  Sick: { icon: 'medkit-outline', bg: colors.amberLight, color: colors.amber },
  Calm: { icon: 'leaf-outline', bg: colors.successLight, color: colors.success },
};

const VIEW_OPTIONS = [
  { key: 'summary', label: 'Summary' },
  { key: 'story', label: 'Story' },
  { key: 'trends', label: 'Trends' },
];

function minutesToDuration(minutes) {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes}m`;
  const remainder = minutes % 60;
  return `${Math.floor(minutes / 60)}h${remainder ? ` ${remainder}m` : ''}`;
}

function calcMinutes(start, end) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startMinutes = (startHour * 60) + startMinute;
  let endMinutes = (endHour * 60) + endMinute;
  if (endMinutes < startMinutes) endMinutes += 24 * 60;
  return endMinutes - startMinutes;
}

function percentageChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function requestedWeekStart(value) {
  if (!value) return startOfWeek(new Date(), { weekStartsOn: 1 });
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return startOfWeek(new Date(), { weekStartsOn: 1 });
  return startOfWeek(parsed, { weekStartsOn: 1 });
}

function moodMeta(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const key = Object.keys(MOOD_META).find((candidate) => candidate.toLowerCase() === normalized);
  return MOOD_META[key] || MOOD_META.Curious;
}

function displayMood(value) {
  const normalized = String(value || '').trim();
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1).toLowerCase()}` : 'Mood';
}

function summarizeWeek({ logs, meals, sleeps, activities, diapers, weekStart }) {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekLogs = logs.filter((log) => log.log_date >= format(weekStart, 'yyyy-MM-dd')
    && log.log_date <= format(weekEnd, 'yyyy-MM-dd'));
  const logIds = new Set(weekLogs.map((log) => log.id));
  const weekMeals = meals.filter((entry) => logIds.has(entry.daily_log_id));
  const weekSleeps = sleeps.filter((entry) => logIds.has(entry.daily_log_id));
  const weekActivities = activities.filter((entry) => logIds.has(entry.daily_log_id));
  const weekDiapers = diapers.filter((entry) => logIds.has(entry.daily_log_id));
  const logById = new Map(weekLogs.map((log) => [log.id, log]));
  const logByDate = new Map(weekLogs.map((log) => [log.log_date, log]));

  const moodCounts = {};
  weekLogs.forEach((log) => (log.moods || []).forEach((mood) => {
    moodCounts[mood] = (moodCounts[mood] || 0) + 1;
  }));
  const topMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const mealAmounts = { all: 0, some: 0, none: 0 };
  weekMeals.forEach((meal) => {
    const amount = String(meal.amount || '').toLowerCase();
    if (Object.hasOwn(mealAmounts, amount)) mealAmounts[amount] += 1;
  });

  const sleepByLog = {};
  weekSleeps.forEach((sleep) => {
    sleepByLog[sleep.daily_log_id] = (sleepByLog[sleep.daily_log_id] || 0)
      + calcMinutes(sleep.start_time, sleep.end_time);
  });
  const sleepValues = Object.values(sleepByLog).filter(Boolean);
  const totalSleepMinutes = sleepValues.reduce((total, value) => total + value, 0);
  const averageSleepMinutes = sleepValues.length
    ? Math.round(totalSleepMinutes / sleepValues.length)
    : 0;

  const activityCounts = {};
  weekActivities.forEach((activity) => {
    const name = activity.activity_name || 'Activity';
    activityCounts[name] = (activityCounts[name] || 0) + 1;
  });
  const topActivities = Object.entries(activityCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const dayBreakdown = eachDayOfInterval({ start: weekStart, end: weekEnd }).map((date) => {
    const dateString = format(date, 'yyyy-MM-dd');
    const log = logByDate.get(dateString);
    if (!log) return { date, dateString, hasLog: false };
    const dayMeals = weekMeals.filter((meal) => meal.daily_log_id === log.id);
    const dayActivities = weekActivities.filter((activity) => activity.daily_log_id === log.id);
    const sleepMinutes = sleepByLog[log.id] || 0;
    const allEaten = dayMeals.filter((meal) => String(meal.amount).toLowerCase() === 'all').length;
    const score = (allEaten * 2) + (sleepMinutes >= 45 ? 2 : 0)
      + ((log.moods || []).includes('Happy') ? 2 : 0) + dayActivities.length;
    return {
      date,
      dateString,
      hasLog: true,
      sent: Boolean(log.sent_to_parents),
      moods: log.moods || [],
      mealCount: dayMeals.length,
      allEaten,
      sleepMinutes,
      activities: dayActivities.map((activity) => activity.activity_name).filter(Boolean),
      score,
    };
  });

  const bestDay = [...dayBreakdown].filter((day) => day.hasLog)
    .sort((left, right) => right.score - left.score)[0] || null;

  return {
    topMoods,
    mealAmounts,
    totalMeals: weekMeals.length,
    totalSleepMinutes,
    averageSleepMinutes,
    diaperCount: weekDiapers.length,
    topActivities,
    dayBreakdown,
    bestDay,
    logCount: weekLogs.length,
    sentCount: weekLogs.filter((log) => log.sent_to_parents).length,
    mealCountsByDay: dayBreakdown.map((day) => day.mealCount || 0),
    sleepCountsByDay: dayBreakdown.map((day) => day.sleepMinutes || 0),
    activityCount: weekActivities.length,
    logById,
  };
}

function IconTitle({ icon, children }) {
  return (
    <View style={styles.cardTitleRow}>
      <View style={styles.cardTitleIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={styles.cardTitle}>{children}</Text>
    </View>
  );
}

function StatCard({ icon, value, label }) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DeltaBadge({ value, suffix = 'vs last week' }) {
  const positive = value >= 0;
  return (
    <View style={[styles.deltaBadge, { backgroundColor: positive ? colors.successLight : colors.amberLight }]}>
      <Ionicons name={positive ? 'trending-up' : 'trending-down'} size={13} color={positive ? colors.success : colors.amber} />
      <Text style={[styles.deltaText, { color: positive ? colors.success : colors.amber }]}>
        {positive ? '+' : ''}{value}% {suffix}
      </Text>
    </View>
  );
}

function MetricBars({ values, labels, color = colors.primary, maxHeight = 58 }) {
  const maxValue = Math.max(...values, 1);
  return (
    <View style={styles.chart}>
      {values.map((value, index) => (
        <View key={`${labels[index]}-${index}`} style={styles.chartColumn}>
          <Text style={styles.chartValue}>{value || '—'}</Text>
          <View style={styles.chartTrack}>
            <View style={[styles.chartBar, { height: value ? Math.max(6, Math.round((value / maxValue) * maxHeight)) : 2, backgroundColor: color }]} />
          </View>
          <Text style={styles.chartLabel}>{labels[index]}</Text>
        </View>
      ))}
    </View>
  );
}

export default function WeeklySummaryScreen({ route }) {
  const navigation = useNavigation();
  const { childId, childName = 'Your child', weekDate, viewMode: requestedViewMode } = route?.params || {};
  const [weekStart, setWeekStart] = useState(() => requestedWeekStart(weekDate));
  const [viewMode, setViewMode] = useState(() => (
    VIEW_OPTIONS.some((option) => option.key === requestedViewMode) ? requestedViewMode : 'summary'
  ));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    if (!weekDate) return;
    const nextWeekStart = requestedWeekStart(weekDate);
    setWeekStart((currentWeekStart) => (
      format(currentWeekStart, 'yyyy-MM-dd') === format(nextWeekStart, 'yyyy-MM-dd')
        ? currentWeekStart
        : nextWeekStart
    ));
  }, [weekDate]);

  React.useEffect(() => {
    if (VIEW_OPTIONS.some((option) => option.key === requestedViewMode)) {
      setViewMode(requestedViewMode);
    }
  }, [requestedViewMode]);

  const loadWeek = useCallback(async ({ silent = false } = {}) => {
    if (!childId) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const previousWeekStart = subWeeks(weekStart, 1);
    const from = format(previousWeekStart, 'yyyy-MM-dd');
    const to = format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    try {
      const { data: logs = [], error: logsError } = await supabase
        .from('daily_logs')
        .select('id, log_date, moods, sent_to_parents')
        .eq('child_id', childId)
        .gte('log_date', from)
        .lte('log_date', to)
        .order('log_date');
      if (logsError) throw logsError;

      const logIds = logs.map((log) => log.id);
      let meals = [];
      let sleeps = [];
      let activities = [];
      let diapers = [];
      if (logIds.length) {
        const results = await Promise.all([
          supabase.from('meal_entries').select('*').in('daily_log_id', logIds),
          supabase.from('sleep_entries').select('*').in('daily_log_id', logIds),
          supabase.from('activity_entries').select('*').in('daily_log_id', logIds),
          supabase.from('diaper_entries').select('*').in('daily_log_id', logIds),
        ]);
        const entryError = results.find((result) => result.error)?.error;
        if (entryError) throw entryError;
        [meals, sleeps, activities, diapers] = results.map((result) => result.data || []);
      }

      const source = { logs, meals, sleeps, activities, diapers };
      setData({
        current: summarizeWeek({ ...source, weekStart }),
        previous: summarizeWeek({ ...source, weekStart: previousWeekStart }),
      });
    } catch (loadError) {
      setError(loadError.message || 'We could not load this weekly summary.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [childId, weekStart]);

  useFocusEffect(useCallback(() => {
    loadWeek();
  }, [loadWeek]));

  const current = data?.current;
  const previous = data?.previous;
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;
  const isCurrentWeek = format(weekStart, 'yyyy-MM-dd')
    === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const labels = current?.dayBreakdown.map((day) => format(day.date, 'EEE')) || [];
  const noLogDays = current?.dayBreakdown.filter((day) => !day.hasLog
    && ![0, 6].includes(day.date.getDay())
    && !isAfter(startOfDay(day.date), startOfDay(new Date()))) || [];

  const story = useMemo(() => {
    if (!current?.logCount) return `There are no daily logs for ${childName} in this week yet.`;
    const mood = current.topMoods[0]?.[0]?.toLowerCase();
    const activity = current.topActivities[0]?.[0];
    const parts = [`${childName} had ${current.logCount} day${current.logCount === 1 ? '' : 's'} recorded`];
    if (mood) parts.push(`was most often ${mood}`);
    if (activity) parts.push(`and enjoyed ${activity} most`);
    return `${parts.join(', ')}. ${current.totalMeals} meals and ${minutesToDuration(current.totalSleepMinutes)} of naps were logged.`;
  }, [childName, current]);

  const openDay = (day) => {
    if (!day.hasLog) return;
    navigation.navigate('ParentHome', { childId, logDate: day.dateString });
  };

  const messageCenter = () => {
    const rootNavigation = navigation.getParent();
    if (rootNavigation) rootNavigation.navigate('Messaging', { childId, childName });
    else navigation.navigate('MessagesTab', { childId, childName });
  };

  const shareSummary = async () => {
    if (!current) return;
    await Share.share({
      title: `${childName}'s weekly recap`,
      message: `${childName}'s week · ${weekLabel}\n${story}`,
    });
  };

  const renderDayStrip = () => (
    <View style={styles.dayStrip}>
      {current.dayBreakdown.map((day) => {
        const mood = day.moods?.[0] ? moodMeta(day.moods[0]) : null;
        return (
          <TouchableOpacity
            key={day.dateString}
            accessibilityRole="button"
            accessibilityLabel={`${format(day.date, 'EEEE, MMMM d')}${day.hasLog ? ', open daily log' : ', no log'}`}
            disabled={!day.hasLog}
            onPress={() => openDay(day)}
            style={styles.dayColumn}
          >
            <Text style={styles.dayName}>{format(day.date, 'EEE')}</Text>
            <View style={[styles.dayCircle, day.hasLog && styles.dayCircleLogged]}>
              <Text style={[styles.dayNumber, day.hasLog && styles.dayNumberLogged]}>{format(day.date, 'd')}</Text>
            </View>
            {mood ? <Ionicons name={mood.icon} size={14} color={mood.color} /> : <View style={styles.dayMoodSpacer} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderSummary = () => (
    <>
      {renderDayStrip()}
      <View style={styles.statsGrid}>
        <StatCard icon="moon-outline" value={minutesToDuration(current.averageSleepMinutes)} label="Avg. nap" />
        <StatCard icon="restaurant-outline" value={current.totalMeals} label="Meals" />
        <StatCard icon="water-outline" value={current.diaperCount} label="Care checks" />
        <StatCard icon="time-outline" value={minutesToDuration(current.totalSleepMinutes)} label="Total sleep" />
      </View>

      {current.topMoods.length > 0 ? (
        <View style={styles.card}>
          <IconTitle icon="happy-outline">Mood this week</IconTitle>
          <View style={styles.chipRow}>
            {current.topMoods.map(([mood, count]) => {
              const meta = moodMeta(mood);
              return (
                <View key={mood} style={[styles.moodChip, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={17} color={meta.color} />
                  <Text style={[styles.moodChipText, { color: meta.color }]}>{displayMood(mood)}</Text>
                  <Text style={[styles.moodChipCount, { color: meta.color }]}>{count}×</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {current.totalMeals > 0 ? (
        <View style={styles.card}>
          <IconTitle icon="restaurant-outline">Meals this week</IconTitle>
          <View style={styles.mealBar}>
            {Object.entries(current.mealAmounts).map(([amount, count]) => count ? (
              <View
                key={amount}
                style={[styles.mealBarPart, {
                  flex: count,
                  backgroundColor: amount === 'all' ? colors.success : amount === 'some' ? colors.amber : colors.danger,
                }]}
              />
            ) : null)}
          </View>
          <View style={styles.legendRow}>
            <Text style={[styles.legendText, { color: colors.success }]}>All eaten {current.mealAmounts.all}</Text>
            <Text style={[styles.legendText, { color: colors.amber }]}>Some {current.mealAmounts.some}</Text>
            <Text style={[styles.legendText, { color: colors.danger }]}>None {current.mealAmounts.none}</Text>
          </View>
        </View>
      ) : null}

      {current.topActivities.length > 0 ? (
        <View style={styles.card}>
          <IconTitle icon="color-palette-outline">Most common activities</IconTitle>
          {current.topActivities.map(([activity, count]) => (
            <View key={activity} style={styles.activityRow}>
              <Text numberOfLines={1} style={styles.activityName}>{activity}</Text>
              <View style={styles.activityTrack}>
                <View style={[styles.activityBar, { width: `${Math.max(12, (count / current.topActivities[0][1]) * 100)}%` }]} />
              </View>
              <Text style={styles.activityCount}>{count}×</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.card}>
        <IconTitle icon="calendar-outline">Day by day</IconTitle>
        {current.dayBreakdown.map((day) => (
          <TouchableOpacity
            key={day.dateString}
            disabled={!day.hasLog}
            onPress={() => openDay(day)}
            style={styles.dayRow}
          >
            <Text style={styles.dayRowDate}>{format(day.date, 'EEE d')}</Text>
            {!day.hasLog ? <Text style={styles.dayRowEmpty}>No log</Text> : (
              <View style={styles.dayRowDetails}>
                <Ionicons name={day.moods[0] ? moodMeta(day.moods[0]).icon : 'ellipse-outline'} size={16} color={day.moods[0] ? moodMeta(day.moods[0]).color : colors.textFaint} />
                <Text style={styles.dayRowStat}>{day.mealCount} meals</Text>
                {day.sleepMinutes ? <Text style={styles.dayRowStat}>{minutesToDuration(day.sleepMinutes)} nap</Text> : null}
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const renderStory = () => (
    <>
      <View style={[styles.card, styles.storyHero]}>
        <View style={styles.storyHeroIcon}>
          <Ionicons name="sparkles" size={24} color={colors.purple} />
        </View>
        <Text style={styles.storyEyebrow}>THE WEEK IN A NUTSHELL</Text>
        <Text style={styles.storyTitle}>{childName}'s week</Text>
        <Text style={styles.storyBody}>{story}</Text>
        <TouchableOpacity style={styles.shareButton} onPress={shareSummary}>
          <Ionicons name="share-outline" size={17} color={colors.primary} />
          <Text style={styles.shareButtonText}>Share this recap</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.storyMetricGrid}>
        <StatCard icon="calendar-outline" value={current.logCount} label="Days logged" />
        <StatCard icon="happy-outline" value={current.topMoods[0] ? displayMood(current.topMoods[0][0]) : '—'} label="Top mood" />
        <StatCard icon="moon-outline" value={minutesToDuration(current.totalSleepMinutes)} label="Nap time" />
        <StatCard icon="color-palette-outline" value={current.activityCount} label="Activities" />
      </View>

      {noLogDays.length ? (
        <View style={styles.noticeCard}>
          <View style={styles.noticeTextWrap}>
            <Text style={styles.noticeTitle}>{noLogDays.length} {noLogDays.length === 1 ? 'day is' : 'days are'} missing a log</Text>
            <Text style={styles.noticeBody}>Ask the center if you expected an update.</Text>
          </View>
          <TouchableOpacity style={styles.noticeButton} onPress={messageCenter}>
            <Text style={styles.noticeButtonText}>Ask</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {current.bestDay ? (
        <TouchableOpacity style={styles.card} onPress={() => openDay(current.bestDay)}>
          <IconTitle icon="star-outline">A day to remember</IconTitle>
          <Text style={styles.featureDay}>{format(current.bestDay.date, 'EEEE, MMMM d')}</Text>
          <Text style={styles.featureDayBody}>
            {current.bestDay.moods[0] ? `${childName} felt ${current.bestDay.moods[0].toLowerCase()}. ` : ''}
            {current.bestDay.activities.length ? `They enjoyed ${current.bestDay.activities.slice(0, 2).join(' and ')}. ` : ''}
            {current.bestDay.sleepMinutes ? `Nap time was ${minutesToDuration(current.bestDay.sleepMinutes)}.` : ''}
          </Text>
          <View style={styles.inlineLink}>
            <Text style={styles.inlineLinkText}>Open daily log</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.primary} />
          </View>
        </TouchableOpacity>
      ) : null}
    </>
  );

  const renderTrends = () => {
    const mealDelta = percentageChange(current.totalMeals, previous.totalMeals);
    const sleepDelta = percentageChange(current.averageSleepMinutes, previous.averageSleepMinutes);
    return (
      <>
        <View style={styles.card}>
          <View style={styles.trendHeader}>
            <IconTitle icon="restaurant-outline">Meals by day</IconTitle>
            <DeltaBadge value={mealDelta} />
          </View>
          <MetricBars values={current.mealCountsByDay} labels={labels} color={colors.success} />
        </View>

        <View style={styles.card}>
          <View style={styles.trendHeader}>
            <IconTitle icon="moon-outline">Nap minutes</IconTitle>
            <DeltaBadge value={sleepDelta} />
          </View>
          <MetricBars values={current.sleepCountsByDay} labels={labels} color={colors.purple} />
        </View>

        <View style={styles.insightGrid}>
          <View style={styles.insightCard}>
            <Ionicons name="star" size={20} color={colors.amber} />
            <Text style={styles.insightLabel}>Best day</Text>
            <Text style={styles.insightValue}>{current.bestDay ? format(current.bestDay.date, 'EEEE') : '—'}</Text>
          </View>
          <View style={styles.insightCard}>
            <Ionicons name="brush" size={20} color={colors.purple} />
            <Text style={styles.insightLabel}>Top activity</Text>
            <Text numberOfLines={2} style={styles.insightValue}>{current.topActivities[0]?.[0] || '—'}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <IconTitle icon="document-text-outline">Weekly reports</IconTitle>
          <View style={styles.reportRow}>
            <View>
              <Text style={styles.reportTitle}>Daily logs received</Text>
              <Text style={styles.reportMeta}>{current.sentCount} sent · {Math.max(current.logCount - current.sentCount, 0)} pending</Text>
            </View>
            <Text style={styles.reportValue}>{current.logCount}</Text>
          </View>
          <View style={styles.reportRow}>
            <View>
              <Text style={styles.reportTitle}>Care activities recorded</Text>
              <Text style={styles.reportMeta}>Meals, naps, activities and care checks</Text>
            </View>
            <Text style={styles.reportValue}>{current.totalMeals + current.activityCount + current.diaperCount}</Text>
          </View>
        </View>
      </>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadWeek({ silent: true })} tintColor={colors.primary} />}
    >
      <View style={styles.titleRow}>
        <View style={styles.titleTextWrap}>
          <Text style={styles.pageTitle}>{childName}'s week</Text>
          <Text style={styles.pageSubtitle}>A clear look at care, learning and routines</Text>
        </View>
        <TouchableOpacity accessibilityLabel="Share weekly recap" style={styles.headerShare} onPress={shareSummary} disabled={!current?.logCount}>
          <Ionicons name="share-outline" size={20} color={current?.logCount ? colors.primary : colors.textFaint} />
        </TouchableOpacity>
      </View>

      {error ? (
        <TouchableOpacity style={styles.errorBanner} onPress={() => loadWeek()}>
          <Text style={styles.errorText}>{error} Tap to retry.</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.weekNavigation}>
        <TouchableOpacity accessibilityLabel="Previous week" onPress={() => setWeekStart((date) => subWeeks(date, 1))} style={styles.weekButton}>
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.weekLabel}>{weekLabel}</Text>
        <TouchableOpacity
          accessibilityLabel="Next week"
          disabled={isCurrentWeek}
          onPress={() => setWeekStart((date) => addWeeks(date, 1))}
          style={[styles.weekButton, isCurrentWeek && styles.disabled]}
        >
          <Ionicons name="chevron-forward" size={18} color={isCurrentWeek ? colors.textFaint : colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.segmentedControl}>
        {VIEW_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === option.key }}
            onPress={() => setViewMode(option.key)}
            style={[styles.segment, viewMode === option.key && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, viewMode === option.key && styles.segmentTextActive]}>{option.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !current?.logCount ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}><Ionicons name="calendar-outline" size={28} color={colors.primary} /></View>
          <Text style={styles.emptyTitle}>No logs this week yet</Text>
          <Text style={styles.emptyBody}>Daily updates from the center will build this recap automatically.</Text>
          {!isAfter(weekStart, new Date()) ? (
            <TouchableOpacity style={styles.outlineButton} onPress={messageCenter}>
              <Text style={styles.outlineButtonText}>Message the center</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : viewMode === 'story' ? renderStory() : viewMode === 'trends' ? renderTrends() : renderSummary()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 44 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  titleTextWrap: { flex: 1 },
  pageTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 25 },
  pageSubtitle: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  headerShare: { width: 42, height: 42, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  errorBanner: { borderWidth: 1, borderColor: `${colors.danger}44`, borderRadius: radius.md, backgroundColor: colors.dangerLight, padding: spacing.md, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12.5, lineHeight: 18 },
  weekNavigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, marginBottom: spacing.md },
  weekButton: { width: 48, height: 46, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  weekLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  segmentedControl: { flexDirection: 'row', backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 4, marginBottom: spacing.lg },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surface, shadowColor: '#17335B', shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  segmentText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 13 },
  segmentTextActive: { color: colors.primary },
  loadingWrap: { paddingVertical: 80, alignItems: 'center' },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.xxl },
  emptyIcon: { width: 58, height: 58, borderRadius: radius.full, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19 },
  emptyBody: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: spacing.sm },
  outlineButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.lg },
  outlineButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  dayStrip: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: spacing.md, marginBottom: spacing.md },
  dayColumn: { flex: 1, alignItems: 'center' },
  dayName: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 10, marginBottom: 5 },
  dayCircle: { width: 31, height: 31, borderRadius: radius.full, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  dayCircleLogged: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayNumber: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 12 },
  dayNumberLogged: { color: colors.white },
  dayMoodSpacer: { height: 14 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { width: '48%', flexGrow: 1, minHeight: 96, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  statValue: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18, marginTop: 5 },
  statLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  cardTitleIcon: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  cardTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  moodChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  moodChipText: { fontFamily: fonts.bold, fontSize: 12 },
  moodChipCount: { fontFamily: fonts.black, fontSize: 11 },
  mealBar: { flexDirection: 'row', height: 9, overflow: 'hidden', borderRadius: radius.full, backgroundColor: colors.borderSoft, marginTop: spacing.lg },
  mealBarPart: { height: '100%' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  legendText: { fontFamily: fonts.bold, fontSize: 11 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  activityName: { width: 100, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
  activityTrack: { flex: 1, height: 8, overflow: 'hidden', backgroundColor: colors.borderSoft, borderRadius: radius.full },
  activityBar: { height: '100%', backgroundColor: colors.purple, borderRadius: radius.full },
  activityCount: { width: 25, textAlign: 'right', color: colors.textMuted, fontFamily: fonts.bold, fontSize: 11 },
  dayRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  dayRowDate: { width: 54, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12 },
  dayRowEmpty: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12 },
  dayRowDetails: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  dayRowStat: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
  storyHero: { alignItems: 'center', backgroundColor: colors.purpleLight, borderColor: '#D9CCF3', paddingVertical: spacing.xxl },
  storyHeroIcon: { width: 54, height: 54, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  storyEyebrow: { color: colors.purple, fontFamily: fonts.black, fontSize: 10, letterSpacing: 1.2 },
  storyTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 22, marginTop: spacing.xs },
  storyBody: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: spacing.sm },
  shareButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.lg },
  shareButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  storyMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  noticeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.amberLight, borderWidth: 1, borderColor: '#ECD4A5', borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  noticeTextWrap: { flex: 1, paddingRight: spacing.sm },
  noticeTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  noticeBody: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  noticeButton: { borderWidth: 1, borderColor: colors.amber, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  noticeButtonText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 12 },
  featureDay: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18, marginTop: spacing.lg },
  featureDayBody: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
  inlineLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  inlineLinkText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  trendHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deltaBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  deltaText: { fontFamily: fonts.bold, fontSize: 9 },
  chart: { height: 108, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.xs, marginTop: spacing.lg },
  chartColumn: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  chartValue: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 9, marginBottom: 4 },
  chartTrack: { height: 60, width: '72%', alignItems: 'stretch', justifyContent: 'flex-end', backgroundColor: colors.primarySoft, borderRadius: radius.sm, overflow: 'hidden' },
  chartBar: { width: '100%', borderRadius: radius.sm },
  chartLabel: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 9, marginTop: 5 },
  insightGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  insightCard: { flex: 1, minHeight: 120, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  insightLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11, marginTop: spacing.sm },
  insightValue: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16, marginTop: 3 },
  reportRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderSoft, paddingVertical: spacing.md },
  reportTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  reportMeta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10, marginTop: 3 },
  reportValue: { color: colors.primary, fontFamily: fonts.black, fontSize: 20 },
});
