import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDays, format, parseISO } from 'date-fns';

import { useParentAbsences } from '../../hooks/useParentAbsences';
import { useParentFamily } from '../../hooks/useParentFamily';
import { colors, fonts, radius, spacing } from '../../theme';

const DATE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'range', label: 'Date range' },
];
const REASONS = [
  { value: 'sick', label: 'Sick', icon: 'medical-outline' },
  { value: 'appointment', label: 'Appointment', icon: 'calendar-outline' },
  { value: 'vacation', label: 'Vacation', icon: 'airplane-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

function fromDateString(value) {
  return parseISO(`${value}T12:00:00`);
}

function initials(child) {
  return `${child?.first_name?.[0] || ''}${child?.last_name?.[0] || ''}`.toUpperCase() || '?';
}

function dateLabel(startsOn, endsOn) {
  const start = fromDateString(startsOn);
  const end = fromDateString(endsOn);
  if (startsOn === endsOn) return format(start, 'EEEE, MMMM d');
  if (start.getMonth() === end.getMonth()) return `${format(start, 'MMM d')}–${format(end, 'd, yyyy')}`;
  return `${format(start, 'MMM d')}–${format(end, 'MMM d, yyyy')}`;
}

function ReportRow({ report, onEdit, onCancel }) {
  const active = report.status === 'active';
  return (
    <View style={[styles.reportRow, !active && styles.reportRowInactive]}>
      <View style={[styles.reportIcon, { backgroundColor: active ? colors.amberLight : colors.bg }]}>
        <Ionicons name={active ? 'calendar-outline' : 'close-outline'} size={19} color={active ? colors.amber : colors.textFaint} />
      </View>
      <View style={styles.reportCopy}>
        <View style={styles.reportHeadingRow}>
          <Text style={styles.reportTitle}>{dateLabel(report.starts_on, report.ends_on)}</Text>
          <Text style={[styles.reportStatus, !active && styles.reportStatusCancelled]}>
            {active ? 'Reported' : 'Cancelled'}
          </Text>
        </View>
        <Text style={styles.reportMeta}>
          {REASONS.find((item) => item.value === report.reason)?.label || 'Other'}
          {report.note ? ` · ${report.note}` : ''}
        </Text>
        {report.editable ? (
          <View style={styles.reportActions}>
            <TouchableOpacity onPress={() => onEdit(report)} accessibilityRole="button">
              <Text style={styles.reportAction}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onCancel(report)} accessibilityRole="button">
              <Text style={[styles.reportAction, { color: colors.danger }]}>Cancel absence</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function ReportAbsenceScreen({ navigation, route }) {
  const family = useParentFamily();
  const routeChildId = route.params?.childId || route.params?.child?.id;
  const child = route.params?.child
    || family.children.find((candidate) => candidate.id === routeChildId)
    || family.selectedChild
    || null;
  const absences = useParentAbsences(child?.id);
  const formRef = useRef(null);
  const [dateOption, setDateOption] = useState('today');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [picker, setPicker] = useState(null);
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState({});

  const selectedDates = useMemo(() => {
    const base = new Date();
    if (dateOption === 'today') return { start: base, end: base };
    if (dateOption === 'tomorrow') {
      const tomorrow = addDays(base, 1);
      return { start: tomorrow, end: tomorrow };
    }
    return { start: startDate, end: endDate };
  }, [dateOption, endDate, startDate]);

  function resetForm() {
    setDateOption('today');
    setStartDate(new Date());
    setEndDate(new Date());
    setReason(null);
    setNote('');
    setEditingId(null);
    setValidation({});
    setPicker(null);
  }

  function editReport(report) {
    const start = fromDateString(report.starts_on);
    const end = fromDateString(report.ends_on);
    setDateOption('range');
    setStartDate(start);
    setEndDate(end);
    setReason(report.reason);
    setNote(report.note || '');
    setEditingId(report.id);
    setValidation({});
    requestAnimationFrame(() => formRef.current?.scrollTo({ y: 0, animated: true }));
  }

  function confirmCancel(report) {
    Alert.alert(
      'Cancel this absence?',
      `${child?.first_name || 'Your child'} will return to the expected attendance list for future dates. The center will be notified.`,
      [
        { text: 'Keep absence', style: 'cancel' },
        {
          text: 'Cancel absence', style: 'destructive', onPress: async () => {
            try {
              await absences.cancel(report.id);
              if (editingId === report.id) resetForm();
            } catch (error) {
              Alert.alert('Could not cancel absence', error.message);
            }
          },
        },
      ],
    );
  }

  async function submit() {
    const nextValidation = {};
    if (!reason) nextValidation.reason = 'Choose a reason for the absence.';
    if (selectedDates.end < selectedDates.start) nextValidation.dates = 'The end date must be on or after the start date.';
    setValidation(nextValidation);
    if (Object.keys(nextValidation).length || saving) return;
    setSaving(true);
    try {
      const result = await absences.submit({
        startsOn: format(selectedDates.start, 'yyyy-MM-dd'),
        endsOn: format(selectedDates.end, 'yyyy-MM-dd'),
        reason,
        note,
        reportId: editingId,
      });
      navigation.replace('AbsenceSubmitted', { child, result });
    } catch (error) {
      Alert.alert('Could not report absence', error.message);
    } finally {
      setSaving(false);
    }
  }

  const roomName = absences.hub?.child?.classroom_name || child?.classroom?.name || 'Classroom';
  const educators = absences.hub?.child?.educators || [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()} accessibilityLabel="Close report absence">
            <Ionicons name="close" size={23} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{editingId ? 'Edit absence' : 'Report an absence'}</Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView
          ref={formRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={absences.refreshing} onRefresh={() => absences.refresh({ quiet: true })} tintColor={colors.primary} />}
        >
          <View style={styles.childCard}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(child)}</Text></View>
            <View style={styles.childCopy}>
              <Text style={styles.childName}>{child?.first_name} {child?.last_name}</Text>
              <Text style={styles.childMeta}>{roomName}{educators.length ? ` · ${educators.join(', ')}` : ''}</Text>
            </View>
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          </View>

          <Text style={styles.sectionTitle}>When will {child?.first_name || 'your child'} be away?</Text>
          <View style={styles.segmented}>
            {DATE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.segment, dateOption === option.value && styles.segmentActive]}
                onPress={() => { setDateOption(option.value); setValidation((value) => ({ ...value, dates: null })); }}
                accessibilityRole="radio"
                accessibilityState={{ selected: dateOption === option.value }}
              >
                <Text style={[styles.segmentText, dateOption === option.value && styles.segmentTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {dateOption === 'range' ? (
            <View style={styles.dateFields}>
              {[
                { key: 'start', label: 'Starts', value: startDate },
                { key: 'end', label: 'Ends', value: endDate },
              ].map((field) => (
                <TouchableOpacity key={field.key} style={[styles.dateField, validation.dates && styles.fieldError]} onPress={() => setPicker(field.key)}>
                  <Text style={styles.dateFieldLabel}>{field.label}</Text>
                  <View style={styles.dateFieldValueRow}>
                    <Text style={styles.dateFieldValue}>{format(field.value, 'MMM d, yyyy')}</Text>
                    <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.singleDateCard}>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
              <Text style={styles.singleDateText}>{format(selectedDates.start, 'EEEE, MMMM d')}</Text>
            </View>
          )}
          {validation.dates ? <Text style={styles.validationText}>{validation.dates}</Text> : null}

          {picker ? (
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={picker === 'start' ? startDate : endDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                minimumDate={picker === 'end' ? startDate : new Date()}
                maximumDate={addDays(picker === 'end' ? startDate : new Date(), 30)}
                onChange={(event, value) => {
                  if (Platform.OS !== 'ios') setPicker(null);
                  if (!value) return;
                  if (picker === 'start') {
                    setStartDate(value);
                    if (value > endDate) setEndDate(value);
                  } else setEndDate(value);
                  setValidation((current) => ({ ...current, dates: null }));
                }}
              />
              {Platform.OS === 'ios' ? (
                <TouchableOpacity style={styles.pickerDone} onPress={() => setPicker(null)}><Text style={styles.pickerDoneText}>Done</Text></TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Reason <Text style={styles.required}>*</Text></Text>
          <View style={styles.reasonGrid}>
            {REASONS.map((option) => {
              const selected = reason === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.reasonChip, validation.reason && styles.fieldError, selected && styles.reasonChipActive]}
                  onPress={() => { setReason(option.value); setValidation((value) => ({ ...value, reason: null })); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Ionicons name={option.icon} size={20} color={selected ? colors.primary : colors.textMuted} />
                  <Text style={[styles.reasonText, selected && styles.reasonTextActive]}>{option.label}</Text>
                  {selected ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
          {validation.reason ? <Text style={styles.validationText}>{validation.reason}</Text> : null}

          <Text style={styles.sectionTitle}>Note <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={(value) => setNote(value.slice(0, 500))}
            multiline
            textAlignVertical="top"
            placeholder="Anything the educator should know"
            placeholderTextColor={colors.textFaint}
          />
          <Text style={styles.count}>{note.length}/500</Text>

          <View style={styles.infoCard}>
            <Ionicons name="notifications-outline" size={21} color={colors.primary} />
            <Text style={styles.infoText}>
              The classroom team and office will be notified immediately. Reporting an absence does not change billing.
            </Text>
          </View>

          {absences.error ? (
            <TouchableOpacity style={styles.errorCard} onPress={() => absences.refresh()}><Text style={styles.errorText}>{absences.error} Tap to retry.</Text></TouchableOpacity>
          ) : null}

          {absences.loading ? <ActivityIndicator style={styles.listLoader} color={colors.primary} /> : null}
          {!absences.loading && absences.reports.length ? (
            <View style={styles.historyCard}>
              <Text style={styles.historyTitle}>Upcoming & recent absences</Text>
              {absences.reports.map((report) => (
                <ReportRow key={report.id} report={report} onEdit={editReport} onCancel={confirmCancel} />
              ))}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {editingId ? (
            <TouchableOpacity style={styles.cancelEdit} onPress={resetForm}><Text style={styles.cancelEditText}>Discard edit</Text></TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[styles.submitButton, saving && styles.disabled]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : (
              <Text style={styles.submitText}>{editingId ? 'Save changes' : 'Report absence'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  keyboard: { flex: 1 },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontSize: 17, fontFamily: fonts.bold },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  childCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  avatar: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 25, backgroundColor: colors.primaryLight },
  avatarText: { color: colors.primary, fontSize: 16, fontFamily: fonts.bold },
  childCopy: { flex: 1, marginLeft: spacing.md },
  childName: { color: colors.textPrimary, fontSize: 16, fontFamily: fonts.bold },
  childMeta: { marginTop: 3, color: colors.textMuted, fontSize: 12, fontFamily: fonts.regular },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.sm, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  required: { color: colors.danger }, optional: { color: colors.textFaint, fontFamily: fonts.regular },
  segmented: { flexDirection: 'row', gap: spacing.xs, padding: 4, borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  segmentActive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  segmentText: { color: colors.textMuted, fontSize: 12.5, fontFamily: fonts.bold },
  segmentTextActive: { color: colors.primary },
  singleDateCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  singleDateText: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  dateFields: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  dateField: { flex: 1, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  dateFieldLabel: { color: colors.textFaint, fontSize: 11, fontFamily: fonts.bold },
  dateFieldValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  dateFieldValue: { color: colors.textPrimary, fontSize: 13, fontFamily: fonts.bold },
  pickerCard: { marginTop: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  pickerDone: { alignSelf: 'flex-end', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  pickerDoneText: { color: colors.primary, fontSize: 14, fontFamily: fonts.bold },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reasonChip: { width: '48.6%', minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  reasonChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  reasonText: { flex: 1, color: colors.textSecondary, fontSize: 13, fontFamily: fonts.bold },
  reasonTextActive: { color: colors.textPrimary },
  fieldError: { borderColor: colors.danger },
  validationText: { marginTop: 6, color: colors.danger, fontSize: 12, fontFamily: fonts.bold },
  noteInput: { minHeight: 98, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  count: { marginTop: 5, textAlign: 'right', color: colors.textFaint, fontSize: 11, fontFamily: fonts.regular },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  infoText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: fonts.regular },
  errorCard: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { color: colors.danger, fontSize: 12, fontFamily: fonts.bold },
  listLoader: { marginTop: spacing.xl },
  historyCard: { marginTop: spacing.xl, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  historyTitle: { paddingVertical: spacing.lg, color: colors.textPrimary, fontSize: 15, fontFamily: fonts.bold },
  reportRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  reportRowInactive: { opacity: 0.68 },
  reportIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  reportCopy: { flex: 1 },
  reportHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reportTitle: { flex: 1, color: colors.textPrimary, fontSize: 13, fontFamily: fonts.bold },
  reportStatus: { color: colors.success, fontSize: 10.5, fontFamily: fonts.bold },
  reportStatusCancelled: { color: colors.textFaint },
  reportMeta: { marginTop: 3, color: colors.textMuted, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular },
  reportActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  reportAction: { color: colors.primary, fontSize: 12, fontFamily: fonts.bold },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  cancelEdit: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md },
  cancelEditText: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.bold },
  submitButton: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  submitText: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  disabled: { opacity: 0.55 },
});
