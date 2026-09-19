import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';

import { useClassroom } from '../../hooks/useClassroom';
import {
  entryMinutes,
  formatMinutes,
  useStaffTime,
} from '../../hooks/useStaffTime';
import { colors, fonts, radius, spacing } from '../../theme';

function Header({ navigation }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.headerButton}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>My time</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function localTimeLabel(value) {
  const [hours = '0', minutes = '0'] = String(value || '').split(':');
  const hour = Number(hours);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${suffix}`;
}

function scheduleSummary(regularSchedule) {
  if (!regularSchedule.length) return { days: 'No shifts', time: 'No published schedule' };

  const weekdays = regularSchedule.map(row => WEEKDAY_LABELS[Number(row.weekday) - 1]);
  const uniqueTimes = [...new Set(regularSchedule.map(
    row => `${String(row.starts_local).slice(0, 5)}-${String(row.ends_local).slice(0, 5)}`,
  ))];
  const days = weekdays.join(', ') === 'Mon, Tue, Wed, Thu, Fri'
    ? 'Mon–Fri'
    : weekdays.join(', ');
  const first = regularSchedule[0];

  return {
    days,
    time: uniqueTimes.length === 1
      ? `${localTimeLabel(first.starts_local)}–${localTimeLabel(first.ends_local)} shift`
      : 'Shift times vary by day',
  };
}

export default function MyTimeScreen({ navigation }) {
  const { active } = useClassroom();
  const {
    shifts,
    regularSchedule,
    entries,
    openEntry,
    requests,
    loading,
    mutating,
    error,
    reload,
    clockIn,
    clockOut,
  } = useStaffTime();
  const [now, setNow] = useState(new Date());

  useFocusEffect(useCallback(() => {
    reload();
  }, [reload]));

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const weekMinutes = useMemo(
    () => entries.reduce((total, entry) => total + entryMinutes(entry, now), 0),
    [entries, now],
  );
  const schedule = useMemo(() => scheduleSummary(regularSchedule), [regularSchedule]);
  const pendingRequests = useMemo(
    () => requests.filter(request => request.status === 'pending').length,
    [requests],
  );
  const roomName = openEntry?.classroom?.name || active?.name || 'Assigned room';

  async function handleClockIn() {
    const { error: clockError } = await clockIn(active?.id);
    if (clockError) {
      Alert.alert('Could not clock in', clockError.message);
    }
  }

  function handleClockOut() {
    Alert.alert(
      'Clock out now?',
      `Your shift will be submitted with ${formatMinutes(entryMinutes(openEntry, now))} recorded.`,
      [
        { text: 'Keep working', style: 'cancel' },
        {
          text: 'Clock out',
          onPress: async () => {
            const { error: clockError } = await clockOut();
            if (clockError) Alert.alert('Could not clock out', clockError.message);
          },
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <Header navigation={navigation} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={undefined}
      >
        {loading && !entries.length ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <>
            <View style={styles.clockCard}>
              <Text style={styles.clockStatus}>
                {openEntry
                  ? `CLOCKED IN · ${format(new Date(openEntry.clocked_in_at), 'h:mm a')}`
                  : 'READY TO CLOCK IN'}
              </Text>
              <Text style={styles.clockDuration}>
                {openEntry ? formatMinutes(entryMinutes(openEntry, now)) : format(now, 'h:mm a')}
              </Text>
              <Text style={styles.clockRoom}>
                {openEntry ? `today · ${roomName}` : roomName}
              </Text>
              <TouchableOpacity
                onPress={openEntry ? handleClockOut : handleClockIn}
                disabled={mutating || (!openEntry && !active?.id)}
                style={[styles.clockButton, (mutating || (!openEntry && !active?.id)) && styles.disabled]}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                {mutating ? (
                  <ActivityIndicator color={colors.textPrimary} />
                ) : (
                  <Text style={styles.clockButtonText}>{openEntry ? 'Clock out' : 'Clock in'}</Text>
                )}
              </TouchableOpacity>
            </View>

            {error && (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.errorText}>{error.message}</Text>
              </View>
            )}

            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{formatMinutes(weekMinutes)}</Text>
                <Text style={styles.summaryLabel}>This week</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{schedule.days}</Text>
                <Text style={styles.summaryLabel}>{schedule.time}</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={() => navigation.navigate('TimeOffRequests')}
              style={styles.timeOffButton}
              activeOpacity={0.78}
              accessibilityRole="button"
            >
              <Ionicons name="calendar-outline" size={19} color={colors.primary} />
              <View style={styles.timeOffCopy}>
                <Text style={styles.timeOffText}>Time off</Text>
                <Text style={styles.timeOffHint}>
                  {pendingRequests ? `${pendingRequests} awaiting review` : 'Requests and decisions'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate('WeeklyTimesheet')}
              style={styles.timesheetLink}
              accessibilityRole="button"
            >
              <Text style={styles.timesheetText}>View this week’s timesheet</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  headerTitle: { fontSize: 22, fontFamily: fonts.black, color: colors.textPrimary },
  headerSpacer: { width: 36, height: 36 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  loader: { marginTop: 80 },
  clockCard: {
    minHeight: 252,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.textPrimary,
  },
  clockStatus: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.75,
  },
  clockDuration: {
    color: colors.white,
    fontFamily: fonts.black,
    fontSize: 40,
    letterSpacing: -0.8,
    marginTop: spacing.sm,
  },
  clockRoom: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  clockButton: {
    minWidth: 132,
    minHeight: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  clockButtonText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  disabled: { opacity: 0.5 },
  errorCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { flex: 1, color: colors.danger, fontFamily: fonts.regular, fontSize: 13 },
  summaryRow: { flexDirection: 'row', gap: spacing.md },
  summaryCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 82,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  summaryValue: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18 },
  summaryLabel: {
    color: colors.textFaint,
    fontFamily: fonts.regular,
    fontSize: 11.5,
    marginTop: spacing.xs,
  },
  timeOffButton: {
    minHeight: 54,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  timeOffCopy: { flex: 1 },
  timeOffText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 15 },
  timeOffHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  timesheetLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 42,
  },
  timesheetText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13.5 },
});
