import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';

import { useStaffTime } from '../../hooks/useStaffTime';
import { colors, fonts, radius, spacing } from '../../theme';

const STATUS = {
  approved: { label: 'Approved', color: colors.success, bg: colors.successLight, icon: 'checkmark' },
  declined: { label: 'Declined · tap for reason', color: colors.danger, bg: colors.dangerLight, icon: 'close' },
  pending: { label: 'Pending review', color: colors.amber, bg: colors.amberLight, icon: 'ellipse' },
  cancelled: { label: 'Withdrawn', color: colors.textMuted, bg: colors.primarySoft, icon: 'remove' },
};

const KIND_LABELS = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Personal',
  unpaid: 'Unpaid leave',
  other: 'Appointment',
};

function dateRange(request) {
  const start = parseISO(request.startsOn);
  const end = parseISO(request.endsOn);
  if (request.startsOn === request.endsOn) return format(start, 'MMM d');
  if (format(start, 'yyyy-MM') === format(end, 'yyyy-MM')) {
    return `${format(start, 'MMM d')}–${format(end, 'd')}`;
  }
  return `${format(start, 'MMM d')}–${format(end, 'MMM d')}`;
}

function RequestCard({ request, onPress }) {
  const meta = STATUS[request.status] || STATUS.pending;
  const reviewer = request.reviewerName ? ` · ${request.reviewerName.split(' ')[0]}` : '';
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.requestCard}
      activeOpacity={0.78}
      accessibilityRole="button"
      accessibilityLabel={`View ${KIND_LABELS[request.kind] || 'time off'} request, ${meta.label}`}
    >
      <View style={[styles.statusIcon, { backgroundColor: meta.bg }]}>
        <Ionicons name={meta.icon} size={18} color={meta.color} />
      </View>
      <View style={styles.requestCopy}>
        <Text style={styles.requestTitle}>
          {dateRange(request)} · {KIND_LABELS[request.kind] || 'Time off'}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.statusText, { color: meta.color }]}>
            {meta.label}{request.status !== 'declined' ? reviewer : ''}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

export default function TimeOffRequestsScreen({ navigation }) {
  const {
    requests,
    paidLeaveRemaining,
    loading,
    error,
    reload,
  } = useStaffTime();

  useFocusEffect(useCallback(() => {
    reload();
  }, [reload]));

  const activeRequests = useMemo(
    () => requests.filter(request => request.status !== 'cancelled'),
    [requests],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Time off</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && requests.length > 0} onRefresh={reload} tintColor={colors.primary} />}
      >
        <View style={styles.balanceCard}>
          <View style={styles.balanceIcon}>
            <Ionicons name="calendar-outline" size={19} color={colors.primary} />
          </View>
          <Text style={styles.balanceText}>
            You have <Text style={styles.balanceStrong}>{paidLeaveRemaining} days</Text> remaining this year.
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => navigation.navigate('TimeOffRequest')}
          style={styles.primaryButton}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={20} color={colors.white} />
          <Text style={styles.primaryButtonText}>Request time off</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>YOUR REQUESTS</Text>

        {loading && !requests.length ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Requests could not be loaded</Text>
              <Text style={styles.errorText}>{error.message || 'Pull down or try again.'}</Text>
            </View>
            <TouchableOpacity onPress={reload}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
          </View>
        ) : activeRequests.length ? (
          <View style={styles.requestList}>
            {activeRequests.map(request => (
              <RequestCard
                key={request.id}
                request={request}
                onPress={() => navigation.navigate('TimeOffDetail', { requestId: request.id, request })}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-clear-outline" size={29} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>No requests yet</Text>
            <Text style={styles.emptyText}>Approved, declined and pending requests will appear here.</Text>
          </View>
        )}

        <Text style={styles.footerText}>
          Requests go to your director’s time-off calendar. Decisions and notes return here automatically.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.xl, borderBottomWidth: 1.5, borderBottomColor: colors.primaryLight,
  },
  headerButton: { width: 38, height: 44, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 21, fontFamily: fonts.black, color: colors.textPrimary },
  headerSpacer: { width: 38 },
  content: { padding: spacing.xl, paddingBottom: 52, gap: spacing.lg },
  balanceCard: {
    minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.primaryLight, paddingHorizontal: spacing.lg,
  },
  balanceIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  balanceText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, color: colors.textMuted },
  balanceStrong: { fontFamily: fonts.bold, color: colors.textPrimary },
  primaryButton: {
    minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  sectionLabel: { marginTop: spacing.xs, fontSize: 11.5, letterSpacing: 1, fontFamily: fonts.bold, color: colors.textFaint },
  loader: { marginTop: 42 },
  requestList: { gap: spacing.md },
  requestCard: {
    minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  statusIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  requestCopy: { flex: 1, minWidth: 0 },
  requestTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  statusBadge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  statusText: { fontSize: 11, fontFamily: fonts.bold },
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg,
    backgroundColor: colors.dangerLight, borderRadius: radius.md,
  },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.danger, fontFamily: fonts.bold, fontSize: 13 },
  errorText: { color: colors.danger, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  retryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  emptyCard: { alignItems: 'center', padding: spacing.xxl, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border },
  emptyTitle: { marginTop: spacing.sm, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  emptyText: { marginTop: spacing.xs, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  footerText: { paddingHorizontal: spacing.md, textAlign: 'center', color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 18 },
});
