import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns';

import { useStaffTime } from '../../hooks/useStaffTime';
import { exportTimeOffCalendar } from '../../lib/export';
import { colors, fonts, radius, spacing } from '../../theme';

const KIND_LABELS = {
  vacation: 'Vacation request',
  sick: 'Sick leave',
  personal: 'Personal day',
  unpaid: 'Unpaid leave',
  other: 'Appointment',
};

const STATUS = {
  approved: { label: 'Approved', color: colors.success, bg: colors.successLight, border: '#BFE4CE', icon: 'checkmark' },
  declined: { label: 'Declined', color: colors.danger, bg: colors.dangerLight, border: '#F0C9BB', icon: 'close' },
  pending: { label: 'Pending review', color: colors.amber, bg: colors.amberLight, border: '#EFD9B5', icon: 'time-outline' },
  cancelled: { label: 'Withdrawn', color: colors.textMuted, bg: colors.primarySoft, border: colors.border, icon: 'remove' },
};

function dateRange(request) {
  const start = parseISO(request.startsOn);
  const end = parseISO(request.endsOn);
  if (request.startsOn === request.endsOn) return format(start, 'MMM d, yyyy');
  if (format(start, 'yyyy-MM') === format(end, 'yyyy-MM')) {
    return `${format(start, 'MMM d')}–${format(end, 'd, yyyy')}`;
  }
  return `${format(start, 'MMM d')}–${format(end, 'MMM d, yyyy')}`;
}

function TimelineRow({ done, last, title, subtitle }) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={[styles.timelineDot, done ? styles.timelineDone : styles.timelinePending]}>
          {done ? <Ionicons name="checkmark" size={12} color={colors.success} /> : <View style={styles.pendingPoint} />}
        </View>
        {!last ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.timelineCopy}>
        <Text style={styles.timelineTitle}>{title}</Text>
        <Text style={styles.timelineSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

export default function TimeOffDetailScreen({ navigation, route }) {
  const fallbackRequest = route.params?.request;
  const requestId = route.params?.requestId || fallbackRequest?.id;
  const { requests, loading, mutating, error, reload, withdrawTimeOff } = useStaffTime();
  const [exporting, setExporting] = useState(false);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const request = useMemo(
    () => requests.find(item => item.id === requestId) || fallbackRequest || null,
    [fallbackRequest, requestId, requests],
  );

  if (loading && !request) {
    return <SafeAreaView style={styles.safeArea}><ActivityIndicator color={colors.primary} style={styles.loader} /></SafeAreaView>;
  }

  if (!request) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity>
          <Text style={styles.headerTitle}>Time off</Text><View style={styles.headerSpacer} />
        </View>
        <View style={styles.missingCard}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.amber} />
          <Text style={styles.missingTitle}>Request unavailable</Text>
          <Text style={styles.missingText}>{error?.message || 'It may have been removed or belong to another account.'}</Text>
          <TouchableOpacity onPress={reload} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Try again</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const meta = STATUS[request.status] || STATUS.pending;
  const reviewer = request.reviewerName || 'Your director';
  const requestedAt = request.createdAt ? format(new Date(request.createdAt), 'MMM d') : 'Submitted';
  const reviewedAt = request.reviewedAt ? format(new Date(request.reviewedAt), 'MMM d · h:mm a') : null;

  function requestDifferentDates() {
    const previousStart = parseISO(request.startsOn);
    const span = differenceInCalendarDays(parseISO(request.endsOn), previousStart);
    const minimum = addDays(startOfDay(new Date()), 7);
    const shifted = addDays(previousStart, 7);
    const nextStart = shifted > minimum ? shifted : minimum;
    navigation.navigate('TimeOffRequest', {
      previousRequestId: request.id,
      kind: request.kind,
      reason: request.reason || '',
      startsOn: format(nextStart, 'yyyy-MM-dd'),
      endsOn: format(addDays(nextStart, span), 'yyyy-MM-dd'),
    });
  }

  function confirmWithdraw() {
    Alert.alert(
      'Withdraw this request?',
      'Your director will no longer see it as pending. You can submit another request later.',
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Withdraw', style: 'destructive', onPress: async () => {
            const result = await withdrawTimeOff(request.id);
            if (result.error) {
              Alert.alert('Could not withdraw request', result.error.message);
            } else {
              navigation.goBack();
            }
          },
        },
      ],
    );
  }

  async function addToCalendar() {
    setExporting(true);
    try {
      await exportTimeOffCalendar(request);
    } catch (calendarError) {
      Alert.alert('Could not open calendar', calendarError.message || 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{KIND_LABELS[request.kind] || 'Time off'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Dates</Text><Text style={styles.detailValue}>{dateRange(request)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Length</Text><Text style={styles.detailValue}>{request.days} {request.days === 1 ? 'workday' : 'workdays'}</Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowLast]}>
            <Text style={styles.detailLabel}>Your note</Text><Text style={[styles.detailValue, styles.noteValue]}>{request.reason || 'No note added'}</Text>
          </View>
        </View>

        <View style={[styles.decisionCard, { backgroundColor: meta.bg, borderColor: meta.border }]}>
          <View style={styles.decisionHeading}>
            <View style={[styles.decisionIcon, { backgroundColor: colors.white }]}>
              <Ionicons name={meta.icon} size={16} color={meta.color} />
            </View>
            <Text style={[styles.decisionTitle, { color: meta.color }]}>
              {request.status === 'pending' ? 'Awaiting director review' : `${meta.label} by ${reviewer}`}
            </Text>
          </View>
          {request.decisionNotes ? <Text style={styles.decisionNotes}>“{request.decisionNotes}”</Text> : null}
          <Text style={[styles.decisionTime, { color: meta.color }]}>
            {reviewedAt || (request.status === 'pending' ? `Requested ${requestedAt}` : 'Status updated')}
          </Text>
        </View>

        {request.status === 'approved' ? (
          <View style={styles.timelineCard}>
            <TimelineRow done title="Requested by you" subtitle={requestedAt} />
            <TimelineRow done title={`Approved by ${reviewer}`} subtitle={reviewedAt || 'Approved'} />
            <TimelineRow done last title="On the schedule" subtitle={`${dateRange(request)} blocked`} />
          </View>
        ) : null}

        {request.status === 'declined' || request.status === 'cancelled' ? (
          <TouchableOpacity onPress={requestDifferentDates} style={styles.primaryButton} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>Request different dates</Text>
          </TouchableOpacity>
        ) : null}

        {request.status === 'pending' ? (
          <TouchableOpacity onPress={confirmWithdraw} disabled={mutating} style={styles.withdrawButton}>
            {mutating ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.withdrawText}>Withdraw request</Text>}
          </TouchableOpacity>
        ) : null}

        {request.status === 'approved' ? (
          <TouchableOpacity onPress={addToCalendar} disabled={exporting} style={styles.calendarButton} activeOpacity={0.8}>
            {exporting ? <ActivityIndicator color={colors.primary} /> : (
              <><Ionicons name="calendar-outline" size={18} color={colors.primary} /><Text style={styles.calendarText}>Add to my calendar</Text></>
            )}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  loader: { marginTop: 160 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, borderBottomWidth: 1.5, borderBottomColor: colors.primaryLight },
  headerButton: { width: 38, height: 44, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontSize: 20, fontFamily: fonts.black },
  headerSpacer: { width: 38 },
  content: { padding: spacing.xl, paddingBottom: 52, gap: spacing.lg },
  detailsCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg },
  detailRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.primarySoft },
  detailRowLast: { borderBottomWidth: 0, alignItems: 'flex-start', paddingVertical: spacing.md },
  detailLabel: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
  detailValue: { flex: 1, color: colors.textPrimary, fontSize: 13, fontFamily: fonts.bold, textAlign: 'right' },
  noteValue: { fontFamily: fonts.regular, lineHeight: 19 },
  decisionCard: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  decisionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  decisionIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  decisionTitle: { flex: 1, fontSize: 14.5, fontFamily: fonts.black },
  decisionNotes: { color: colors.textPrimary, fontSize: 13, lineHeight: 20, fontFamily: fonts.regular },
  decisionTime: { fontSize: 11, fontFamily: fonts.regular, opacity: 0.75 },
  timelineCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  timelineRow: { flexDirection: 'row', minHeight: 57, gap: spacing.md },
  timelineRail: { width: 28, alignItems: 'center' },
  timelineDot: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  timelineDone: { backgroundColor: colors.successLight },
  timelinePending: { backgroundColor: colors.amberLight },
  pendingPoint: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.amber },
  timelineLine: { width: 2, flex: 1, marginVertical: 2, backgroundColor: colors.border },
  timelineCopy: { flex: 1, paddingTop: 3 },
  timelineTitle: { color: colors.textPrimary, fontSize: 13.5, fontFamily: fonts.bold },
  timelineSubtitle: { marginTop: 3, color: colors.textFaint, fontSize: 11.5, fontFamily: fonts.regular },
  primaryButton: { minHeight: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  primaryButtonText: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  withdrawButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  withdrawText: { color: colors.danger, fontSize: 14, fontFamily: fonts.bold },
  calendarButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  calendarText: { color: colors.primary, fontSize: 14.5, fontFamily: fonts.bold },
  missingCard: { margin: spacing.xl, marginTop: 80, padding: spacing.xxl, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border },
  missingTitle: { marginTop: spacing.md, color: colors.textPrimary, fontSize: 17, fontFamily: fonts.bold },
  missingText: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, textAlign: 'center' },
  secondaryButton: { marginTop: spacing.lg, minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  secondaryButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
});
