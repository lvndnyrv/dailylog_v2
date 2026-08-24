import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { addDays, format } from 'date-fns';

import {
  entryMinutes,
  formatMinutes,
  localDateKey,
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
      <Text style={styles.headerTitle}>This week</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function dayRows(weekStart, shifts, entries) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const key = localDateKey(date);
    const dayEntries = entries.filter(entry => localDateKey(entry.clocked_in_at) === key);
    const dayShifts = shifts.filter(shift => localDateKey(shift.starts_at) === key);
    return { date, dayEntries, dayShifts };
  }).filter((row, index) => index < 5 || row.dayEntries.length || row.dayShifts.length);
}

function rowSummary(row, now) {
  if (row.dayEntries.length) {
    const first = row.dayEntries[0];
    const last = row.dayEntries[row.dayEntries.length - 1];
    const end = last.clocked_out_at ? format(new Date(last.clocked_out_at), 'h:mm') : 'now';
    const minutes = row.dayEntries.reduce(
      (total, entry) => total + entryMinutes(entry, now),
      0,
    );
    return {
      middle: `${format(new Date(first.clocked_in_at), 'h:mm')} – ${end}`,
      value: formatMinutes(minutes),
      active: row.dayEntries.some(entry => !entry.clocked_out_at),
    };
  }

  if (row.dayShifts.length) {
    return { middle: 'Scheduled', value: '—', scheduled: true };
  }

  return { middle: 'Not scheduled', value: '—', muted: true };
}

export default function WeeklyTimesheetScreen({ navigation }) {
  const { weekStart, shifts, entries, loading, error, reload } = useStaffTime();
  const [now, setNow] = useState(new Date());

  useFocusEffect(useCallback(() => {
    reload();
  }, [reload]));

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(
    () => dayRows(weekStart, shifts, entries),
    [entries, shifts, weekStart],
  );
  const total = useMemo(
    () => entries.reduce((minutes, entry) => minutes + entryMinutes(entry, now), 0),
    [entries, now],
  );

  return (
    <View style={styles.screen}>
      <Header navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.weekLabel}>
          {format(weekStart, 'MMM d')}–{format(addDays(weekStart, 6), 'MMM d, yyyy')}
        </Text>

        {loading && !entries.length && !shifts.length ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.timesheetCard}>
            {rows.map((row, index) => {
              const summary = rowSummary(row, now);
              return (
                <View
                  key={localDateKey(row.date)}
                  style={[styles.dayRow, index < rows.length - 1 && styles.dayBorder]}
                >
                  <Text style={styles.dayName}>{format(row.date, 'EEE MMM d')}</Text>
                  <Text style={[
                    styles.dayTime,
                    (summary.scheduled || summary.muted) && styles.mutedText,
                  ]}>
                    {summary.middle}
                  </Text>
                  <Text style={[
                    styles.dayTotal,
                    summary.active && styles.activeText,
                    (summary.scheduled || summary.muted) && styles.mutedText,
                  ]}>
                    {summary.value}
                  </Text>
                </View>
              );
            })}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatMinutes(total)}</Text>
            </View>
          </View>
        )}

        {error && <Text style={styles.errorText}>{error.message}</Text>}

        <View style={styles.infoCard}>
          <View style={styles.infoIcon}>
            <Ionicons name="time-outline" size={17} color={colors.primary} />
          </View>
          <Text style={styles.infoText}>
            Your clock-ins sync to your director’s payroll timesheet automatically.
          </Text>
        </View>
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
  headerTitle: {
    flex: 1,
    marginLeft: spacing.md,
    fontSize: 21,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  headerSpacer: { width: 36 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  weekLabel: {
    color: colors.textFaint,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.45,
    marginBottom: spacing.md,
  },
  loader: { marginVertical: 70 },
  timesheetCard: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  dayRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  dayBorder: { borderBottomWidth: 1, borderBottomColor: colors.primarySoft },
  dayName: {
    width: 92,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 13.5,
  },
  dayTime: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  dayTotal: {
    width: 58,
    textAlign: 'right',
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  activeText: { color: colors.primary },
  mutedText: { color: colors.textFaint },
  totalRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: '#F8FBFE',
  },
  totalLabel: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14 },
  totalValue: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  errorText: {
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: spacing.md,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  infoText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
});
