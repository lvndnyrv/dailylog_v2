import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { addDays, format, isSameWeek } from 'date-fns';

import {
  entryMinutes,
  formatMinutes,
  localDateKey,
  useStaffTime,
} from '../../hooks/useStaffTime';
import { supabase } from '../../lib/supabase';
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
      <Text style={styles.headerTitle}>Timesheet</Text>
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
    const rejected = row.dayEntries.find(entry => entry.status === 'rejected');
    const reviewLabel = rejected
      ? 'Needs correction'
      : row.dayEntries.every(entry => entry.status === 'approved')
        ? 'Approved'
        : row.dayEntries.some(entry => entry.status === 'submitted')
          ? 'Awaiting approval'
          : null;
    return {
      middle: `${format(new Date(first.clocked_in_at), 'h:mm')} – ${end}`,
      value: formatMinutes(minutes),
      active: row.dayEntries.some(entry => !entry.clocked_out_at),
      reviewLabel,
      reviewNote: rejected?.notes || null,
      reviewTone: rejected ? 'danger' : reviewLabel === 'Approved' ? 'success' : 'amber',
    };
  }

  if (row.dayShifts.length) {
    return { middle: 'Scheduled', value: '—', scheduled: true };
  }

  return { middle: 'Not scheduled', value: '—', muted: true };
}

function routeWeekDate(value) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function withTime(value, time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(value);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export default function WeeklyTimesheetScreen({ navigation, route }) {
  const targetEntryId = route?.params?.entryId || null;
  const [weekAnchor, setWeekAnchor] = useState(() => routeWeekDate(route?.params?.clockedAt));
  const { weekStart, shifts, entries, loading, error, reload, resubmitTimeEntry, mutating } = useStaffTime({ weekDate: weekAnchor });
  const [now, setNow] = useState(new Date());
  const [correctionEntry, setCorrectionEntry] = useState(null);

  useEffect(() => {
    if (route?.params?.clockedAt) {
      setWeekAnchor(routeWeekDate(route.params.clockedAt));
      return undefined;
    }
    if (!targetEntryId) return undefined;

    let active = true;
    supabase
      .from('staff_time_entries')
      .select('clocked_in_at')
      .eq('id', targetEntryId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data?.clocked_in_at) setWeekAnchor(routeWeekDate(data.clocked_in_at));
      });
    return () => { active = false; };
  }, [route?.params?.clockedAt, route?.params?.linkedAt, targetEntryId]);

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
  const currentWeek = isSameWeek(weekStart, new Date(), { weekStartsOn: 1 });

  return (
    <View style={styles.screen}>
      <Header navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.weekPicker}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Previous week"
            onPress={() => setWeekAnchor(addDays(weekStart, -7))}
            style={styles.weekButton}
          >
            <Ionicons name="chevron-back" size={18} color={colors.primary} />
          </TouchableOpacity>
          <View style={styles.weekHeading}>
            <Text style={styles.weekLabel}>{currentWeek ? 'THIS WEEK' : 'WEEK'}</Text>
            <Text style={styles.weekDates}>
              {format(weekStart, 'MMM d')}–{format(addDays(weekStart, 6), 'MMM d, yyyy')}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Next week"
            accessibilityState={{ disabled: currentWeek }}
            disabled={currentWeek}
            onPress={() => setWeekAnchor(addDays(weekStart, 7))}
            style={[styles.weekButton, currentWeek && styles.weekButtonDisabled]}
          >
            <Ionicons name="chevron-forward" size={18} color={currentWeek ? colors.textFaint : colors.primary} />
          </TouchableOpacity>
        </View>

        {loading && !entries.length && !shifts.length ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.timesheetCard}>
            {rows.map((row, index) => {
              const summary = rowSummary(row, now);
              const focused = Boolean(targetEntryId && row.dayEntries.some(entry => entry.id === targetEntryId));
              const rejected = row.dayEntries.find(entry => entry.status === 'rejected');
              return (
                <View
                  key={localDateKey(row.date)}
                  style={[
                    styles.dayRow,
                    index < rows.length - 1 && styles.dayBorder,
                    focused && styles.focusedDayRow,
                  ]}
                >
                  <Text style={styles.dayName}>{format(row.date, 'EEE MMM d')}</Text>
                  <View style={styles.dayTimeBlock}>
                    <Text style={[
                      styles.dayTime,
                      (summary.scheduled || summary.muted) && styles.mutedText,
                    ]}>
                      {summary.middle}
                    </Text>
                    {summary.reviewLabel ? (
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.reviewStatus,
                          summary.reviewTone === 'danger'
                            ? styles.reviewDanger
                            : summary.reviewTone === 'success'
                              ? styles.reviewSuccess
                              : styles.reviewAmber,
                        ]}
                      >
                        {summary.reviewLabel}{summary.reviewNote ? ` · ${summary.reviewNote}` : ''}
                      </Text>
                    ) : null}
                    {rejected ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Fix ${format(row.date, 'EEEE')} time entry`}
                        onPress={() => setCorrectionEntry(rejected)}
                      >
                        <Text style={styles.fixLink}>Fix and resubmit</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
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
            Reviewed entries and correction notes stay here with your weekly hours. Clock-ins sync to your director’s payroll timesheet automatically.
          </Text>
        </View>
      </ScrollView>
      {correctionEntry ? (
        <CorrectionModal
          entry={correctionEntry}
          busy={mutating}
          onClose={() => setCorrectionEntry(null)}
          onSubmit={async values => {
            const result = await resubmitTimeEntry(values);
            if (!result.error) setCorrectionEntry(null);
            return result;
          }}
        />
      ) : null}
    </View>
  );
}

function CorrectionModal({ entry, busy, onClose, onSubmit }) {
  const [clockIn, setClockIn] = useState(format(new Date(entry.clocked_in_at), 'HH:mm'));
  const [clockOut, setClockOut] = useState(format(new Date(entry.clocked_out_at), 'HH:mm'));
  const [breakMinutes, setBreakMinutes] = useState(String(entry.break_minutes || 0));
  const [error, setError] = useState(null);

  const submit = async () => {
    const start = withTime(entry.clocked_in_at, clockIn);
    const end = withTime(entry.clocked_out_at, clockOut);
    const breakValue = Number(breakMinutes);
    if (!start || !end || end <= start) {
      setError('Enter valid times; clock-out must be after clock-in.');
      return;
    }
    if (!Number.isInteger(breakValue) || breakValue < 0 || breakValue >= (end - start) / 60000) {
      setError('Break minutes must be shorter than the shift.');
      return;
    }
    setError(null);
    const result = await onSubmit({
      entryId: entry.id,
      clockedInAt: start.toISOString(),
      clockedOutAt: end.toISOString(),
      breakMinutes: breakValue,
    });
    if (result.error) setError(result.error.message || 'Could not resubmit this entry.');
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              <Text style={styles.modalTitle}>Correct time entry</Text>
              <Text style={styles.modalSubtitle}>{format(new Date(entry.clocked_in_at), 'EEEE, MMMM d')}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.correctionNotice}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={styles.correctionNoticeText}>{entry.notes || 'Your director requested a correction.'}</Text>
          </View>
          <View style={styles.inputRow}>
            <TimeField label="CLOCK IN" value={clockIn} onChangeText={setClockIn} />
            <TimeField label="CLOCK OUT" value={clockOut} onChangeText={setClockOut} />
          </View>
          <Text style={styles.inputLabel}>UNPAID BREAK (MINUTES)</Text>
          <TextInput
            accessibilityLabel="Unpaid break minutes"
            value={breakMinutes}
            onChangeText={setBreakMinutes}
            keyboardType="number-pad"
            style={styles.input}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.modalActions}>
            <TouchableOpacity disabled={busy} onPress={onClose} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={submit} style={[styles.submitButton, busy && styles.disabledButton]}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.submitButtonText}>Resubmit</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TimeField({ label, value, onChangeText }) {
  return (
    <View style={styles.timeField}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label === 'CLOCK IN' ? 'Clock in time' : 'Clock out time'}
        value={value}
        onChangeText={onChangeText}
        placeholder="HH:MM"
        keyboardType="numbers-and-punctuation"
        style={styles.input}
      />
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
  weekPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  weekHeading: { flex: 1, alignItems: 'center', gap: 2 },
  weekButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekButtonDisabled: { backgroundColor: colors.primarySoft, opacity: 0.65 },
  weekLabel: {
    color: colors.textFaint,
    fontFamily: fonts.bold,
    fontSize: 10.5,
    letterSpacing: 0.8,
  },
  weekDates: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
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
  focusedDayRow: {
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.lg - 4,
  },
  dayBorder: { borderBottomWidth: 1, borderBottomColor: colors.primarySoft },
  dayName: {
    width: 92,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 13.5,
  },
  dayTime: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  dayTimeBlock: { flex: 1, gap: 3 },
  reviewStatus: { fontFamily: fonts.bold, fontSize: 11.5, lineHeight: 15 },
  reviewDanger: { color: colors.danger },
  reviewSuccess: { color: colors.success },
  reviewAmber: { color: colors.amber },
  fixLink: { color: colors.primary, fontFamily: fonts.bold, fontSize: 11.5 },
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
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(23,51,91,0.35)' },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.lg },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  modalTitleBlock: { flex: 1 },
  modalTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  modalSubtitle: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  modalClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  correctionNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.dangerLight, padding: spacing.md },
  correctionNoticeText: { flex: 1, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  inputRow: { flexDirection: 'row', gap: spacing.md },
  timeField: { flex: 1 },
  inputLabel: { marginBottom: 6, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.45 },
  input: { minHeight: 46, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: '#F9FBFE', paddingHorizontal: spacing.md, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  cancelButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md },
  cancelButtonText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  submitButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  submitButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  disabledButton: { opacity: 0.55 },
});
