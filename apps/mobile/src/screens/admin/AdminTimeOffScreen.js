import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, subDays } from 'date-fns';

import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

const KIND_LABEL = {
  vacation: 'Vacation',
  sick: 'Sick leave',
  personal: 'Personal day',
  unpaid: 'Unpaid leave',
  other: 'Other',
};

function requestRange(request) {
  const start = parseISO(request.starts_on);
  const end = parseISO(request.ends_on);
  if (request.starts_on === request.ends_on) return format(start, 'MMM d');
  if (format(start, 'yyyy-MM') === format(end, 'yyyy-MM')) return `${format(start, 'MMM d')}–${format(end, 'd')}`;
  return `${format(start, 'MMM d')}–${format(end, 'MMM d')}`;
}

function initials(name) {
  return String(name || 'Staff').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function RequestCard({ request, impacts, onDecision, busy, focused }) {
  const name = request.staff?.profile?.full_name || 'Staff member';
  const room = request.staff?.profile?.classroom?.name || 'Unassigned';
  const requestImpacts = impacts.filter(impact => impact.request_id === request.id);
  const maxGap = requestImpacts.length ? Math.max(...requestImpacts.map(impact => Number(impact.staff_gap || 0))) : 0;
  const rooms = [...new Set(requestImpacts.map(impact => impact.room_name))].join(', ');
  const pending = request.status === 'pending';

  return (
    <View style={[styles.requestCard, focused && styles.requestCardFocused]}>
      <View style={styles.requestHeader}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
        <View style={styles.requestCopy}>
          <Text style={styles.requestName}>{name}</Text>
          <Text style={styles.requestMeta}>{room} · {KIND_LABEL[request.kind] || 'Time off'}</Text>
        </View>
        <View style={[styles.statusBadge, pending ? styles.pendingBadge : request.status === 'approved' ? styles.approvedBadge : styles.declinedBadge]}>
          <Text style={[styles.statusText, pending ? styles.pendingText : request.status === 'approved' ? styles.approvedText : styles.declinedText]}>
            {pending ? 'Pending' : request.status === 'approved' ? 'Approved' : 'Declined'}
          </Text>
        </View>
      </View>

      <View style={styles.dateRow}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={styles.dateText}>{requestRange(request)}</Text>
      </View>
      {request.reason ? <Text style={styles.reason}>{request.reason}</Text> : null}

      {pending && (
        <View style={[styles.coverageCard, maxGap ? styles.coverageDanger : styles.coverageSafe]}>
          <Ionicons name={maxGap ? 'warning-outline' : 'shield-checkmark-outline'} size={19} color={maxGap ? colors.danger : colors.success} />
          <View style={styles.coverageCopy}>
            <Text style={[styles.coverageTitle, maxGap ? styles.dangerText : styles.successText]}>
              {maxGap ? `Coverage gap: ${maxGap} educator${maxGap === 1 ? '' : 's'}` : 'Coverage forecast remains safe'}
            </Text>
            <Text style={styles.coverageDetail}>
              {maxGap ? `${rooms} would fall below planned staffing.` : 'No ratio shortfall is forecast for published shifts.'}
            </Text>
          </View>
        </View>
      )}

      {pending ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.decisionButton, styles.declineButton]}
            onPress={() => onDecision(request, 'declined')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Decline ${name}'s time-off request`}
          >
            <Text style={styles.declineButtonText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.decisionButton, styles.approveButton]}
            onPress={() => onDecision(request, 'approved')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Approve ${name}'s time-off request`}
          >
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.approveButtonText}>Approve</Text>}
          </TouchableOpacity>
        </View>
      ) : request.decision_notes ? (
        <Text style={styles.decisionNote}>Decision note: {request.decision_notes}</Text>
      ) : null}
    </View>
  );
}

export default function AdminTimeOffScreen({ navigation, route }) {
  const { profile } = useAuth();
  const [requests, setRequests] = useState([]);
  const [impacts, setImpacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!profile?.daycare_id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const earliest = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const requestResult = await supabase
      .from('staff_time_off_requests')
      .select(`id, starts_on, ends_on, kind, status, reason, decision_notes, reviewed_at,
        staff:staff_members(id, profile:profiles(id, full_name,
          classroom:classrooms!profiles_classroom_id_fkey(id, name)))`)
      .eq('daycare_id', profile.daycare_id)
      .gte('ends_on', earliest)
      .neq('status', 'cancelled')
      .order('starts_on');

    if (requestResult.error) {
      setError(requestResult.error.message);
      setRequests([]);
      setImpacts([]);
    } else {
      const rows = requestResult.data || [];
      setRequests(rows);
      const pendingIds = rows.filter(row => row.status === 'pending').map(row => row.id);
      if (pendingIds.length) {
        const impactResult = await supabase.rpc('get_staff_time_off_coverage_impacts', { p_request_ids: pendingIds });
        if (impactResult.error) setError(impactResult.error.message);
        setImpacts(impactResult.data || []);
      } else {
        setImpacts([]);
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const pending = useMemo(() => requests
    .filter(request => request.status === 'pending')
    .sort((left, right) => {
      if (left.id === route?.params?.requestId) return -1;
      if (right.id === route?.params?.requestId) return 1;
      return left.starts_on.localeCompare(right.starts_on);
    }), [requests, route?.params?.requestId]);
  const decided = useMemo(() => requests.filter(request => request.status !== 'pending').slice(0, 12), [requests]);

  function decide(request, decision) {
    if (decision === 'declined') {
      setDecisionNotes(request.decision_notes || '');
      setDeclining(request);
      return;
    }
    const name = request.staff?.profile?.full_name || 'this staff member';
    Alert.alert(
      decision === 'approved' ? 'Approve time off?' : 'Decline time off?',
      `${name} · ${requestRange(request)}${decision === 'approved' ? '. Coverage effects shown on this page have been reviewed.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'approved' ? 'Approve' : 'Decline',
          style: decision === 'declined' ? 'destructive' : 'default',
          onPress: () => saveDecision(request, decision),
        },
      ],
    );
  }

  async function saveDecision(request, decision, notes = '') {
    setBusyId(request.id);
    const { data, error: updateError } = await supabase
      .from('staff_time_off_requests')
      .update({
        status: decision,
        decision_notes: notes.trim().slice(0, 1000) || null,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', request.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    setBusyId(null);
    if (updateError) {
      Alert.alert('Could not save decision', updateError.message);
      return;
    }
    if (!data) {
      Alert.alert('Already reviewed', 'This request is no longer pending. The list will refresh.');
    } else {
      setDeclining(null);
      setDecisionNotes('');
      showToast(`Time off ${decision}`, 'success');
    }
    load({ refresh: true });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Staff time off</Text>
          <Text style={styles.headerSub}>Review requests and coverage impact</Text>
        </View>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}><Ionicons name="calendar-outline" size={22} color={colors.primary} /></View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryTitle}>{pending.length ? `${pending.length} request${pending.length === 1 ? '' : 's'} to review` : 'No requests waiting'}</Text>
            <Text style={styles.summaryText}>Coverage is forecast against published shifts and room ratios before approval.</Text>
          </View>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => load()}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Pending requests</Text>
              {pending.length ? <View style={styles.countBadge}><Text style={styles.countText}>{pending.length}</Text></View> : null}
            </View>
            {pending.length ? pending.map(request => (
              <RequestCard key={request.id} request={request} impacts={impacts}
                onDecision={decide} busy={busyId === request.id}
                focused={request.id === route?.params?.requestId} />
            )) : (
              <View style={styles.emptyCard}>
                <Ionicons name="checkmark-circle-outline" size={30} color={colors.success} />
                <Text style={styles.emptyTitle}>You’re all caught up</Text>
                <Text style={styles.emptyText}>New staff requests will appear here with their coverage impact.</Text>
              </View>
            )}

            {decided.length ? (
              <>
                <Text style={[styles.sectionTitle, styles.recentTitle]}>Recently reviewed</Text>
                {decided.map(request => (
                  <RequestCard key={request.id} request={request} impacts={[]} onDecision={decide} busy={false} />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <Modal visible={Boolean(declining)} transparent animationType="slide" onRequestClose={() => !busyId && setDeclining(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => !busyId && setDeclining(null)} />
          <View style={styles.modalCard}>
            <View style={styles.grabber} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleCopy}>
                <Text style={styles.modalTitle}>Decline time off</Text>
                <Text style={styles.modalSub}>{declining?.staff?.profile?.full_name || 'Staff member'} · {declining ? requestRange(declining) : ''}</Text>
              </View>
              <TouchableOpacity onPress={() => !busyId && setDeclining(null)} style={styles.closeButton} accessibilityLabel="Close time-off decision">
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.declineNotice}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.amber} />
              <Text style={styles.declineNoticeText}>Add useful context or suggest alternate dates. The educator will see this note with the decision.</Text>
            </View>

            <Text style={styles.notesLabel}>Note to educator <Text style={styles.optionalText}>(optional)</Text></Text>
            <TextInput
              value={decisionNotes}
              onChangeText={setDecisionNotes}
              placeholder="For example: Could you take the following week instead?"
              placeholderTextColor={colors.textFaint}
              multiline
              maxLength={1000}
              style={styles.notesInput}
              accessibilityLabel="Time-off decision note"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setDeclining(null)} disabled={Boolean(busyId)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalDeclineButton}
                onPress={() => saveDecision(declining, 'declined', decisionNotes)}
                disabled={Boolean(busyId)}
                accessibilityLabel="Send declined time-off decision"
              >
                {busyId ? <ActivityIndicator color={colors.white} /> : <Text style={styles.modalDeclineText}>Send decision</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 64, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, alignItems: 'center' },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19 },
  headerSub: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.primaryLight },
  summaryIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surface },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  summaryText: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  recentTitle: { marginTop: spacing.xl, marginBottom: spacing.md },
  countBadge: { minWidth: 23, height: 23, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, borderRadius: 12, backgroundColor: colors.amberLight },
  countText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 11 },
  requestCard: { padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  requestCardFocused: { borderColor: colors.primary, borderWidth: 2, backgroundColor: '#F8FBFF' },
  requestHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.primaryLight },
  avatarText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  requestCopy: { flex: 1, minWidth: 0 },
  requestName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  requestMeta: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full },
  pendingBadge: { backgroundColor: colors.amberLight },
  approvedBadge: { backgroundColor: colors.successLight },
  declinedBadge: { backgroundColor: colors.dangerLight },
  statusText: { fontFamily: fonts.bold, fontSize: 10 },
  pendingText: { color: colors.amber },
  approvedText: { color: colors.success },
  declinedText: { color: colors.danger },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  dateText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  reason: { marginTop: spacing.sm, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  coverageCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginTop: spacing.md, borderRadius: radius.md },
  coverageSafe: { backgroundColor: colors.successLight },
  coverageDanger: { backgroundColor: colors.dangerLight },
  coverageCopy: { flex: 1 },
  coverageTitle: { fontFamily: fonts.bold, fontSize: 12 },
  coverageDetail: { marginTop: 2, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  successText: { color: colors.success },
  dangerText: { color: colors.danger },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  decisionButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  declineButton: { borderWidth: 1.5, borderColor: '#E9BFC0', backgroundColor: colors.surface },
  approveButton: { backgroundColor: colors.primary },
  declineButtonText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 13 },
  approveButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  decisionNote: { marginTop: spacing.md, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, fontStyle: 'italic' },
  emptyCard: { alignItems: 'center', padding: spacing.xxl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  emptyTitle: { marginTop: spacing.sm, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  emptyText: { marginTop: 4, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, color: colors.danger, fontFamily: fonts.regular, fontSize: 11.5 },
  retryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  loader: { paddingVertical: 60 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23, 51, 91, 0.34)' },
  modalDismiss: { flex: 1 },
  modalCard: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 34, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surface },
  grabber: { width: 42, height: 5, alignSelf: 'center', marginBottom: spacing.lg, borderRadius: 3, backgroundColor: colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  modalTitleCopy: { flex: 1 },
  modalTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  modalSub: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5 },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.bg },
  declineNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.amberLight },
  declineNoticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  notesLabel: { marginTop: spacing.lg, marginBottom: spacing.sm, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  optionalText: { color: colors.textFaint, fontFamily: fonts.regular },
  notesInput: { minHeight: 94, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bg, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md },
  modalCancelText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  modalDeclineButton: { flex: 1.2, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.danger },
  modalDeclineText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
});
