import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addDays, format, parseISO } from 'date-fns';

import { DatePickerField } from '../../components/DatePickerField';
import { useStaffTime } from '../../hooks/useStaffTime';
import { colors, fonts, radius, spacing } from '../../theme';

const TYPES = [
  { id: 'vacation', label: 'Vacation' },
  { id: 'sick', label: 'Sick' },
  { id: 'personal', label: 'Personal' },
  { id: 'other', label: 'Other' },
];

function Header({ navigation, title }) {
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
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function SubmittedView({ navigation, request }) {
  const start = parseISO(request.startsOn);
  const end = parseISO(request.endsOn);
  const sameMonth = format(start, 'MMM') === format(end, 'MMM');
  const dateLabel = sameMonth
    ? `${format(start, 'MMM d')}–${format(end, 'd')}`
    : `${format(start, 'MMM d')}–${format(end, 'MMM d')}`;

  return (
    <View style={styles.submittedScreen}>
      <Header navigation={navigation} title="Request time off" />
      <View style={styles.submittedContent}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={38} color={colors.success} />
        </View>
        <View style={styles.submittedHeading}>
          <Text style={styles.submittedTitle}>Request sent</Text>
          <Text style={styles.submittedText}>
            <Text style={styles.submittedStrong}>
              {dateLabel} · {request.label}
            </Text>
            {'\n'}awaiting your director’s approval.
          </Text>
        </View>

        <View style={styles.timelineCard}>
          <View style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, styles.timelineDotDone]}>
                <Ionicons name="checkmark" size={12} color={colors.success} />
              </View>
              <View style={styles.timelineLine} />
            </View>
            <View style={styles.timelineCopy}>
              <Text style={styles.timelineTitle}>Requested</Text>
              <Text style={styles.timelineSub}>Just now</Text>
            </View>
          </View>
          <View style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, styles.timelineDotPending]}>
                <View style={styles.pendingPoint} />
              </View>
            </View>
            <View style={styles.timelineCopy}>
              <Text style={styles.timelineTitle}>Director review</Text>
              <Text style={styles.pendingText}>Pending · Admin timesheets</Text>
            </View>
          </View>
        </View>

        <View style={styles.submittedSpacer} />
        <TouchableOpacity
          onPress={() => navigation.navigate('TimeOffRequests')}
          style={styles.primaryButton}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TimeOffRequestScreen({ navigation, route }) {
  const replacementId = route.params?.previousRequestId || null;
  const defaultStart = useMemo(
    () => route.params?.startsOn ? parseISO(route.params.startsOn) : addDays(new Date(), 11),
    [route.params?.startsOn],
  );
  const defaultEnd = useMemo(
    () => route.params?.endsOn ? parseISO(route.params.endsOn) : addDays(new Date(), 13),
    [route.params?.endsOn],
  );
  const [kind, setKind] = useState(
    TYPES.some(type => type.id === route.params?.kind) ? route.params.kind : 'vacation',
  );
  const [startsOn, setStartsOn] = useState(format(defaultStart, 'yyyy-MM-dd'));
  const [endsOn, setEndsOn] = useState(format(defaultEnd, 'yyyy-MM-dd'));
  const [reason, setReason] = useState(route.params?.reason || '');
  const [submitted, setSubmitted] = useState(null);
  const {
    paidLeaveRemaining,
    loading,
    mutating,
    requestTimeOff,
    rerequestTimeOff,
  } = useStaffTime();

  const maxDate = useMemo(() => addDays(new Date(), 730), []);

  async function submit() {
    if (!startsOn || !endsOn) {
      Alert.alert('Choose dates', 'Select both the first and last day of your request.');
      return;
    }
    if (endsOn < startsOn) {
      Alert.alert('Check the dates', 'The last day cannot be before the first day.');
      return;
    }

    const result = replacementId
      ? await rerequestTimeOff({ previousRequestId: replacementId, startsOn, endsOn, kind, reason })
      : await requestTimeOff({ startsOn, endsOn, kind, reason });
    if (result.error) {
      Alert.alert('Could not submit request', result.error.message);
      return;
    }

    setSubmitted({
      id: result.data,
      startsOn,
      endsOn,
      kind,
      label: TYPES.find(type => type.id === kind)?.label || 'Time off',
    });
  }

  if (submitted) {
    return <SubmittedView navigation={navigation} request={submitted} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header navigation={navigation} title={replacementId ? 'Request different dates' : 'Request time off'} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.fieldEyebrow}>TYPE</Text>
        <View style={styles.typeRow}>
          {TYPES.map(type => {
            const selected = kind === type.id;
            return (
              <TouchableOpacity
                key={type.id}
                onPress={() => setKind(type.id)}
                style={[styles.typeButton, selected && styles.typeButtonSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.typeText, selected && styles.typeTextSelected]}>
                  {type.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.dateRow}>
          <DatePickerField
            label="From"
            value={startsOn}
            onChange={value => {
              setStartsOn(value);
              if (endsOn < value) setEndsOn(value);
            }}
            placeholder="Start date"
            minimumDate={new Date()}
            maximumDate={maxDate}
            defaultDate={defaultStart}
            style={styles.dateField}
          />
          <DatePickerField
            label="To"
            value={endsOn}
            onChange={setEndsOn}
            placeholder="End date"
            minimumDate={startsOn ? parseISO(startsOn) : new Date()}
            maximumDate={maxDate}
            defaultDate={defaultEnd}
            style={styles.dateField}
          />
        </View>

        <Text style={styles.noteLabel}>
          Note <Text style={styles.optionalText}>(optional)</Text>
        </Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Family trip"
          placeholderTextColor={colors.textFaint}
          style={styles.noteInput}
          maxLength={500}
        />

        <View style={styles.leaveCard}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.leaveText}>
              You have <Text style={styles.leaveStrong}>{paidLeaveRemaining} days</Text> of paid leave
              remaining this year.
            </Text>
          )}
        </View>

        <TouchableOpacity
          onPress={submit}
          disabled={mutating}
          style={[styles.primaryButton, mutating && styles.disabled]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ busy: mutating, disabled: mutating }}
        >
          {mutating ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.primaryButtonText}>{replacementId ? 'Send new request' : 'Submit request'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
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
  fieldEyebrow: {
    color: colors.textFaint,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  typeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  typeButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  typeButtonSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 13 },
  typeTextSelected: { color: colors.white },
  dateRow: { flexDirection: 'row', gap: spacing.md },
  dateField: { flex: 1, minWidth: 0 },
  noteLabel: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 13.5,
    marginBottom: spacing.sm,
  },
  optionalText: { color: colors.textFaint, fontFamily: fonts.regular },
  noteInput: {
    minHeight: 50,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 14.5,
  },
  leaveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  leaveText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  leaveStrong: { color: colors.textPrimary, fontFamily: fonts.bold },
  primaryButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginTop: spacing.xl,
  },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  disabled: { opacity: 0.55 },
  submittedScreen: { flex: 1, backgroundColor: colors.bg },
  submittedContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
  },
  submittedHeading: { alignItems: 'center', marginTop: spacing.lg },
  submittedTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 22 },
  submittedText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  submittedStrong: { color: colors.textPrimary, fontFamily: fonts.bold },
  timelineCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { width: 26, alignItems: 'center' },
  timelineDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotDone: { backgroundColor: colors.successLight },
  timelineDotPending: { backgroundColor: colors.amberLight },
  pendingPoint: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.amber },
  timelineLine: { width: 2, minHeight: 38, flex: 1, backgroundColor: colors.border },
  timelineCopy: { flex: 1, paddingBottom: spacing.lg },
  timelineTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  timelineSub: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  pendingText: { color: colors.amber, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  submittedSpacer: { flex: 1 },
});
