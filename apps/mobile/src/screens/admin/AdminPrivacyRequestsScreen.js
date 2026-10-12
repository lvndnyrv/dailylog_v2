import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';

import { showToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function relation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function dateLabel(value) {
  if (!value) return '';
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'MMM d, yyyy · h:mm a');
}

function RequestCard({ request, focused, busy, onAdvance }) {
  const requester = relation(request.profile);
  const active = ['requested', 'processing'].includes(request.status);
  const exportRequest = request.request_type === 'export';
  const teamRequest = request.source === 'account';
  const statusLabel = request.status === 'requested'
    ? 'Waiting for review'
    : request.status === 'processing'
      ? 'In progress'
      : request.status === 'completed'
        ? 'Handled'
        : request.status;
  return (
    <View style={[styles.requestCard, focused && styles.requestCardFocused]}>
      <View style={styles.requestHeader}>
        <View style={[styles.requestIcon, exportRequest ? styles.requestIconBlue : styles.requestIconDanger]}>
          <Ionicons name={exportRequest ? 'download-outline' : 'trash-outline'} size={20} color={exportRequest ? colors.primary : colors.danger} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.parentName}>{requester?.full_name || 'DailyLog account'}</Text>
          <Text style={styles.parentEmail}>{requester?.email || 'Email unavailable'}</Text>
        </View>
        <View style={[styles.statusBadge, active ? styles.statusBadgeActive : styles.statusBadgeDone]}>
          <Text style={[styles.statusText, active ? styles.statusTextActive : styles.statusTextDone]}>{statusLabel}</Text>
        </View>
      </View>

      <Text style={styles.requestTitle}>{exportRequest ? 'Family data export' : teamRequest ? `${request.role === 'owner_admin' ? 'Owner' : request.role === 'admin' ? 'Admin' : 'Educator'} account closure` : 'Parent account deletion review'}</Text>
      <Text style={styles.requestMeta}>Requested {dateLabel(request.requested_at)}</Text>
      <View style={styles.guidanceCard}>
        <Ionicons name="information-circle-outline" size={18} color={exportRequest ? colors.primary : colors.amber} />
        <Text style={styles.guidanceText}>
          {exportRequest
            ? 'Verify the requester and prepare a copy of their family data within the applicable privacy deadline.'
            : teamRequest
              ? 'Verify identity, transfer active duties, remove access, and review employment or childcare records that must be retained.'
              : 'Verify identity and required record-retention obligations before closing this request. Completing it does not erase protected childcare records.'}
        </Text>
      </View>

      {request.notes ? <Text style={styles.savedNote}>Office note: {request.notes}</Text> : null}
      {active ? (
        <TouchableOpacity
          style={[styles.actionButton, request.status === 'processing' && styles.actionButtonComplete]}
          onPress={() => onAdvance(request)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`${request.status === 'requested' ? 'Start review' : 'Mark handled'} for ${requester?.full_name || 'account'}`}
        >
          {busy ? <ActivityIndicator color={colors.white} /> : (
            <>
              <Text style={styles.actionText}>{request.status === 'requested' ? 'Start review' : 'Mark handled'}</Text>
              <Ionicons name="arrow-forward" size={17} color={colors.white} />
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function AdminPrivacyRequestsScreen({ navigation, route }) {
  const { profile } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [officeNote, setOfficeNote] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!profile?.daycare_id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const [parentResult, accountResult] = await Promise.all([
      supabase
        .from('parent_data_requests')
        .select('id, request_type, status, requested_at, completed_at, updated_at, notes, handled_by, profile:profiles!parent_data_requests_profile_id_fkey(id, full_name, email)')
        .eq('daycare_id', profile.daycare_id)
        .order('requested_at', { ascending: false })
        .limit(50),
      supabase
        .from('account_deletion_requests')
        .select('id, role, status, requested_at, completed_at, updated_at, notes, handled_by, profile:profiles!account_deletion_requests_profile_id_fkey(id, full_name, email)')
        .eq('daycare_id', profile.daycare_id)
        .order('requested_at', { ascending: false })
        .limit(50),
    ]);
    const parentRequests = (parentResult.data || []).map(request => ({ ...request, source: 'parent' }));
    const accountRequests = (accountResult.data || []).map(request => ({ ...request, source: 'account', request_type: 'deletion' }));
    setRequests([...parentRequests, ...accountRequests]);
    setError(parentResult.error?.message || accountResult.error?.message || '');
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id]);

  useEffect(() => { load(); }, [load]);

  const orderedRequests = useMemo(() => {
    const focusId = route.params?.requestId;
    return [...requests].sort((left, right) => {
      if (left.id === focusId) return -1;
      if (right.id === focusId) return 1;
      const priority = { requested: 0, processing: 1, ready: 2, completed: 3, cancelled: 4 };
      return (priority[left.status] ?? 5) - (priority[right.status] ?? 5);
    });
  }, [requests, route.params?.requestId]);
  const openCount = requests.filter(request => ['requested', 'processing'].includes(request.status)).length;

  async function updateStatus(request, nextStatus) {
    setBusyId(request.id);
    const rpcName = request.source === 'account'
      ? 'transition_account_deletion_request'
      : 'transition_parent_data_request';
    const { data, error: updateError } = await supabase.rpc(rpcName, {
      p_request_id: request.id,
      p_expected_status: request.status,
      p_next_status: nextStatus,
      p_notes: officeNote.trim() || null,
    });
    setBusyId(null);
    if (updateError || !data) {
      Alert.alert('Could not update request', updateError?.message || 'Another administrator changed this request. Refresh and try again.');
      return;
    }
    setOfficeNote('');
    showToast(nextStatus === 'processing' ? 'Privacy review started' : 'Privacy request marked handled', 'success');
    await load({ refresh: true });
  }

  function advance(request) {
    const nextStatus = request.status === 'requested' ? 'processing' : 'completed';
    const requester = relation(request.profile);
    const destructive = request.request_type === 'deletion' && nextStatus === 'completed';
    Alert.alert(
      nextStatus === 'processing' ? 'Start this privacy review?' : 'Mark this request handled?',
      destructive
        ? `Confirm that ${requester?.full_name || 'the requester'}'s identity, access, and record-retention requirements were reviewed. This closes the request but does not automatically erase protected records.`
        : nextStatus === 'processing'
          ? 'The requester will be notified that the center has started reviewing the request.'
          : 'The requester will be notified that the request has been completed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: nextStatus === 'processing' ? 'Start review' : 'Mark handled', style: destructive ? 'destructive' : 'default', onPress: () => updateStatus(request, nextStatus) },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Privacy requests</Text>
          <Text style={styles.headerSub}>Family exports and account closure reviews</Text>
        </View>
        <TouchableOpacity onPress={() => load({ refresh: true })} style={styles.headerButton} accessibilityLabel="Refresh privacy requests">
          <Ionicons name="refresh-outline" size={21} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
      >
        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}><Ionicons name="shield-checkmark-outline" size={23} color={colors.primary} /></View>
          <View style={styles.flex}>
            <Text style={styles.summaryTitle}>{openCount ? `${openCount} request${openCount === 1 ? '' : 's'} need attention` : 'No open privacy requests'}</Text>
            <Text style={styles.summaryText}>Status changes notify the requester and remain in the audit trail.</Text>
          </View>
        </View>

        <Text style={styles.noteLabel}>OFFICE NOTE (OPTIONAL)</Text>
        <TextInput
          value={officeNote}
          onChangeText={setOfficeNote}
          placeholder="Internal handling note for the next action"
          placeholderTextColor={colors.textFaint}
          style={styles.noteInput}
          multiline
        />

        {error ? (
          <TouchableOpacity style={styles.errorCard} onPress={() => load()}>
            <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>Privacy requests could not refresh. Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : orderedRequests.length ? (
          orderedRequests.map(request => (
            <RequestCard
              key={request.id}
              request={request}
              focused={request.id === route.params?.requestId}
              busy={busyId === request.id}
              onAdvance={advance}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={34} color={colors.success} />
            <Text style={styles.emptyTitle}>Nothing to review</Text>
            <Text style={styles.emptyText}>New privacy and account closure requests will appear here automatically.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, alignItems: 'center' },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19 },
  headerSub: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.primaryLight },
  summaryIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surface },
  summaryTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  summaryText: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  noteLabel: { marginBottom: spacing.xs, color: colors.textMuted, fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 1.2 },
  noteInput: { minHeight: 66, padding: spacing.md, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 12.5, textAlignVertical: 'top', backgroundColor: colors.surface },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, color: colors.danger, fontFamily: fonts.bold, fontSize: 12 },
  requestCard: { padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  requestCardFocused: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  requestHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  requestIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  requestIconBlue: { backgroundColor: colors.primaryLight },
  requestIconDanger: { backgroundColor: colors.dangerLight },
  parentName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  parentEmail: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full },
  statusBadgeActive: { backgroundColor: colors.amberLight },
  statusBadgeDone: { backgroundColor: colors.successLight },
  statusText: { fontFamily: fonts.bold, fontSize: 9.5 },
  statusTextActive: { color: colors.amber },
  statusTextDone: { color: colors.success },
  requestTitle: { marginTop: spacing.lg, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  requestMeta: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11 },
  guidanceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg },
  guidanceText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  savedNote: { marginTop: spacing.md, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, fontStyle: 'italic' },
  actionButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  actionButtonComplete: { backgroundColor: colors.success },
  actionText: { color: colors.white, fontFamily: fonts.bold, fontSize: 12.5 },
  loader: { paddingVertical: 70 },
  emptyCard: { alignItems: 'center', padding: spacing.xxl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  emptyTitle: { marginTop: spacing.sm, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  emptyText: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, textAlign: 'center' },
});
