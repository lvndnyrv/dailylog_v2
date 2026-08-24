import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useParentSchedule } from '../../hooks/useParentSchedule';
import { colors, fonts, radius, spacing } from '../../theme';
import {
  ScheduleEmpty,
  ScheduleError,
  ScheduleHeader,
  ScheduleLoading,
  scheduleDate,
  scheduleStyles,
  timeLabel,
} from './ParentScheduleShared';

export default function ParentClosuresScreen({ navigation }) {
  const schedule = useParentSchedule();

  useFocusEffect(useCallback(() => {
    schedule.refresh().catch(() => {});
  }, [schedule.refresh]));

  const upcoming = useMemo(() => (schedule.hub?.closures || [])
    .filter((item) => item.ends_on >= schedule.hub.today), [schedule.hub]);

  return (
    <SafeAreaView style={scheduleStyles.safeArea}>
      <ScheduleHeader navigation={navigation} title="Closures & calendar" />
      {!schedule.hub && schedule.loading ? <ScheduleLoading /> : null}
      {!schedule.hub && schedule.error ? (
        <ScheduleError message={schedule.error} onRetry={schedule.refresh} />
      ) : null}
      {schedule.hub ? (
        <ScrollView contentContainerStyle={scheduleStyles.content}>
          <View style={styles.hoursCard}>
            <Ionicons name="time-outline" size={19} color={colors.primary} />
            <Text style={styles.hoursText}>
              Normal hours{' '}
              <Text style={styles.hoursStrong}>
                {timeLabel(schedule.hub.daycare?.opens_at)} – {timeLabel(schedule.hub.daycare?.closes_at)}
              </Text>
              , Monday to Friday.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>UPCOMING CLOSURES</Text>
          {upcoming.length ? upcoming.map((closure, index) => (
            <ClosureRow
              key={closure.id}
              closure={closure}
              highlighted={index === 0}
              onPress={() => navigation.navigate('ParentClosureNotice', { closureId: closure.id })}
            />
          )) : (
            <ScheduleEmpty
              title="No upcoming closures"
              body="The office has not published any closed days."
            />
          )}

          <View style={scheduleStyles.infoCard}>
            <Ionicons name="receipt-outline" size={19} color={colors.primary} />
            <Text style={scheduleStyles.infoText}>
              Days marked “No charge” are excluded from attendance charges. Any tuition adjustment is shown on the invoice issued by your office.
            </Text>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function ClosureRow({ closure, highlighted, onPress }) {
  const sameDay = closure.starts_on === closure.ends_on;
  const sameMonth = closure.starts_on.slice(0, 7) === closure.ends_on.slice(0, 7);
  const primaryDate = sameDay
    ? scheduleDate(closure.starts_on, 'd')
    : sameMonth
      ? `${scheduleDate(closure.starts_on, 'd')}–${scheduleDate(closure.ends_on, 'd')}`
      : scheduleDate(closure.starts_on, 'MMM d');
  const secondaryDate = sameDay || sameMonth
    ? scheduleDate(closure.starts_on, 'MMM').toUpperCase()
    : scheduleDate(closure.ends_on, 'MMM d');
  const weekdayLabel = sameDay
    ? scheduleDate(closure.starts_on, 'EEEE')
    : `${scheduleDate(closure.starts_on, 'EEE')}–${scheduleDate(closure.ends_on, 'EEE')}`;
  return (
    <TouchableOpacity
      style={[styles.closureRow, highlighted && styles.closureRowHighlighted]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
    >
      <View style={styles.dateBlock}>
        <Text style={[styles.dayNumber, !sameMonth && styles.crossMonthDate, highlighted && styles.amberText]}>
          {primaryDate}
        </Text>
        <Text style={[styles.month, highlighted && styles.amberText]}>
          {secondaryDate}
        </Text>
      </View>
      <View style={styles.closureCopy}>
        <Text style={styles.closureTitle}>{closure.reason}</Text>
        <Text style={styles.closureSubtitle}>
          {weekdayLabel} · center closed
        </Text>
      </View>
      {closure.billing_treatment === 'no_charge' ? (
        <Text style={styles.noCharge}>No charge</Text>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  hoursCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  hoursText: {
    flex: 1, color: colors.textSecondary, fontFamily: fonts.regular,
    fontSize: 12.5, lineHeight: 18,
  },
  hoursStrong: { color: colors.textPrimary, fontFamily: fonts.bold },
  sectionLabel: {
    color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.7,
  },
  closureRow: {
    minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  closureRowHighlighted: { backgroundColor: '#FFFDF8', borderColor: '#EFD9B5' },
  dateBlock: { width: 48, alignItems: 'center' },
  dayNumber: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19, lineHeight: 21 },
  crossMonthDate: { fontSize: 12.5, lineHeight: 16 },
  month: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 10.5 },
  amberText: { color: colors.amber },
  closureCopy: { flex: 1, minWidth: 0 },
  closureTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14.5 },
  closureSubtitle: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, marginTop: 2,
  },
  noCharge: {
    color: colors.success, backgroundColor: colors.successLight,
    borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4,
    fontFamily: fonts.bold, fontSize: 10.5,
  },
});
