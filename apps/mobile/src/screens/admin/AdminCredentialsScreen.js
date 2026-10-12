import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';

import { getCredentialDocumentUrl } from '../../hooks/useCredentials';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

function initials(name) {
  return String(name || 'Staff').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function firstRelation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isBackgroundCredential(credential) {
  return /(background|criminal record|vulnerable sector)/i.test(credential?.name || '');
}

function requirementState(credential) {
  if (!credential.completed_on || !credential.document_id) {
    return { kind: 'missing', label: 'Required document is missing' };
  }
  if (!credential.expires_on) return null;
  const days = differenceInCalendarDays(parseISO(credential.expires_on), new Date());
  if (days < 0) return { kind: 'expired', label: `Expired ${format(parseISO(credential.expires_on), 'MMM d, yyyy')}` };
  if (days <= 30) return { kind: 'expiring', label: `Expires in ${days} day${days === 1 ? '' : 's'}` };
  return null;
}

function PendingCard({ submission, onOpen }) {
  const staff = firstRelation(submission.staff);
  const profile = firstRelation(staff?.profile);
  const credential = firstRelation(submission.credential);
  const name = profile?.full_name || 'Staff member';
  return (
    <TouchableOpacity style={styles.pendingCard} onPress={() => onOpen(submission)} activeOpacity={0.74} accessibilityRole="button">
      <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
      <View style={styles.cardCopy}>
        <Text style={styles.staffName}>{name}</Text>
        <Text style={styles.credentialName}>{credential?.name || 'Credential renewal'}</Text>
        <Text style={styles.cardMeta}>Submitted {format(parseISO(submission.created_at), 'MMM d')} · expires {format(parseISO(submission.expires_on), 'MMM d, yyyy')}</Text>
      </View>
      <View style={styles.reviewBadge}><Text style={styles.reviewBadgeText}>Review</Text></View>
      <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

function RequirementCard({ credential, focused, reminding, reminded, onRemind }) {
  const staff = firstRelation(credential.staff);
  const profile = firstRelation(staff?.profile);
  const name = profile?.full_name || 'Staff member';
  const issue = requirementState(credential);
  const urgent = issue?.kind === 'missing' || issue?.kind === 'expired';
  const blocksRatio = Boolean(staff?.background_check_required)
    && isBackgroundCredential(credential)
    && urgent;
  return (
    <View style={[styles.riskCard, focused && styles.riskCardFocused]}>
      <View style={[styles.riskIcon, urgent ? styles.riskIconExpired : styles.riskIconSoon]}>
        <Ionicons name={issue?.kind === 'missing' ? 'document-outline' : urgent ? 'alert-circle-outline' : 'time-outline'} size={19} color={urgent ? colors.danger : colors.amber} />
      </View>
      <View style={styles.cardCopy}>
        <Text style={styles.staffName}>{credential.name}</Text>
        <Text style={styles.credentialName}>{name}{credential.ratio_qualifying ? ' · ratio qualifying' : ''}</Text>
        <Text style={[styles.cardMeta, urgent && styles.dangerText]}>{issue?.label}</Text>
        {blocksRatio ? <Text style={styles.ratioWarning}>Does not count toward staffing ratio</Text> : null}
      </View>
      {credential.required ? (
        <TouchableOpacity
          style={[styles.remindButton, reminded && styles.remindedButton]}
          onPress={() => onRemind(credential)}
          disabled={reminding || reminded}
          accessibilityRole="button"
          accessibilityLabel={`${reminded ? 'Reminder sent for' : 'Send reminder for'} ${credential.name} to ${name}`}
        >
          {reminding ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name={reminded ? 'checkmark' : 'notifications-outline'} size={16} color={reminded ? colors.success : colors.primary} />}
          <Text style={[styles.remindText, reminded && styles.remindedText]}>{reminded ? 'Sent' : 'Remind'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function AdminCredentialsScreen({ navigation, route }) {
  const { profile } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [notesError, setNotesError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openingDocument, setOpeningDocument] = useState(false);
  const [remindingId, setRemindingId] = useState(null);
  const [remindedIds, setRemindedIds] = useState([]);
  const [error, setError] = useState('');
  const openedLinkedReviewRef = useRef(null);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!profile?.daycare_id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const [submissionResult, credentialResult] = await Promise.all([
      supabase.from('staff_credential_submissions')
        .select(`id, issuer, completed_on, expires_on, credential_number, status, created_at,
          credential:staff_credentials(id, name, ratio_qualifying),
          document:documents(id, title, storage_path, mime_type),
          staff:staff_members(id, job_title, background_check_required, profile:profiles(id, full_name, email))`)
        .eq('daycare_id', profile.daycare_id).eq('status', 'pending').order('created_at'),
      supabase.from('staff_credentials')
        .select(`id, name, completed_on, expires_on, document_id, required, ratio_qualifying,
          staff:staff_members(id, status, background_check_required, profile:profiles(id, full_name))`)
        .eq('daycare_id', profile.daycare_id).is('archived_at', null).order('expires_on', { nullsFirst: true }),
    ]);
    const loadError = submissionResult.error || credentialResult.error;
    if (loadError) setError(loadError.message);
    setSubmissions(submissionResult.data || []);
    setCredentials(credentialResult.data || []);
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const submissionId = route?.params?.submissionId;
    if (!submissionId || loading || selected) return;
    const linkKey = `${submissionId}:${route?.params?.linkedAt || 'direct'}`;
    if (openedLinkedReviewRef.current === linkKey) return;
    const linkedSubmission = submissions.find(submission => submission.id === submissionId);
    if (!linkedSubmission) return;
    openedLinkedReviewRef.current = linkKey;
    openReview(linkedSubmission);
  }, [loading, route?.params?.linkedAt, route?.params?.submissionId, selected, submissions]);

  const risks = useMemo(() => credentials
    .filter(credential => firstRelation(credential.staff)?.status !== 'inactive' && requirementState(credential))
    .sort((left, right) => {
      if (left.id === route?.params?.credentialId) return -1;
      if (right.id === route?.params?.credentialId) return 1;
      const priorities = { missing: 0, expired: 1, expiring: 2 };
      return priorities[requirementState(left)?.kind] - priorities[requirementState(right)?.kind];
    }), [credentials, route?.params?.credentialId]);
  const urgentCount = risks.filter(item => ['missing', 'expired'].includes(requirementState(item)?.kind)).length;
  const linkedReviewUnavailable = Boolean(
    route?.params?.submissionId
    && !loading
    && !submissions.some(submission => submission.id === route.params.submissionId),
  );

  function confirmReminder(credential) {
    const staff = firstRelation(credential.staff);
    const staffProfile = firstRelation(staff?.profile);
    Alert.alert(
      'Send credential reminder?',
      `${staffProfile?.full_name || 'This educator'} will receive a reminder to submit ${credential.name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send reminder', onPress: () => sendReminder(credential) },
      ],
    );
  }

  async function sendReminder(credential) {
    setRemindingId(credential.id);
    const { data, error: reminderError } = await supabase.rpc('send_staff_credential_reminder', {
      p_credential_id: credential.id,
      p_remind_again: false,
    });
    setRemindingId(null);
    if (reminderError) {
      Alert.alert('Could not send reminder', reminderError.message);
      return;
    }
    setRemindedIds(current => [...new Set([...current, credential.id])]);
    showToast(data?.sent === false ? 'Reminder already queued today' : 'Credential reminder sent', 'success');
  }

  function openReview(submission) {
    setSelected(submission);
    setReviewNotes('');
    setNotesError('');
  }

  async function openDocument() {
    if (!selected?.document?.storage_path) {
      Alert.alert('Document unavailable', 'No uploaded document is attached to this renewal.');
      return;
    }
    setOpeningDocument(true);
    try {
      const url = await getCredentialDocumentUrl(selected.document.storage_path);
      await Linking.openURL(url);
    } catch (documentError) {
      Alert.alert('Could not open document', documentError.message);
    } finally {
      setOpeningDocument(false);
    }
  }

  async function saveDecision(decision) {
    if (decision === 'rejected' && !reviewNotes.trim()) {
      setNotesError('Explain what the educator needs to correct.');
      return;
    }
    setBusy(true);
    const { error: reviewError } = await supabase.rpc('review_staff_credential_submission', {
      p_submission_id: selected.id,
      p_decision: decision,
      p_review_notes: reviewNotes.trim() || null,
    });
    setBusy(false);
    if (reviewError) {
      Alert.alert('Could not save review', reviewError.message);
      return;
    }
    showToast(decision === 'approved' ? 'Credential renewal approved' : 'Changes requested', 'success');
    setSelected(null);
    await load({ refresh: true });
  }

  function approve() {
    const staff = firstRelation(selected?.staff);
    const staffProfile = firstRelation(staff?.profile);
    const credential = firstRelation(selected?.credential);
    const name = staffProfile?.full_name || 'this educator';
    const restoresRatio = Boolean(staff?.background_check_required)
      && isBackgroundCredential(credential);
    const impact = restoresRatio
      ? ' Once approved, this educator can count toward staffing ratios again.'
      : '';
    Alert.alert('Approve renewal?', `${credential?.name || 'Credential'} for ${name} will become the active verified record.${impact}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => saveDecision('approved') },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Staff credentials</Text>
          <Text style={styles.headerSub}>Renewals and expiry readiness</Text>
        </View>
        <TouchableOpacity onPress={() => load({ refresh: true })} style={styles.headerButton} accessibilityLabel="Refresh credentials">
          <Ionicons name="refresh-outline" size={21} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}><Ionicons name="shield-checkmark-outline" size={23} color={colors.primary} /></View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryTitle}>{submissions.length ? `${submissions.length} renewal${submissions.length === 1 ? '' : 's'} to review` : 'No renewals waiting'}</Text>
            <Text style={styles.summaryText}>{urgentCount ? `${urgentCount} required credential${urgentCount === 1 ? '' : 's'} need immediate follow-up.` : `${risks.length} credential${risks.length === 1 ? '' : 's'} expire within 30 days.`}</Text>
          </View>
        </View>

        {error ? <TouchableOpacity style={styles.errorCard} onPress={() => load()}><Ionicons name="cloud-offline-outline" size={20} color={colors.danger} /><Text style={styles.errorText}>Credentials could not refresh. Tap to retry.</Text></TouchableOpacity> : null}
        {linkedReviewUnavailable ? (
          <View style={styles.infoCard}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
            <Text style={styles.infoText}>This renewal is no longer waiting for review. Another approver may already have handled it.</Text>
          </View>
        ) : null}

        {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : (
          <>
            <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Pending review</Text>{submissions.length ? <View style={styles.countBadge}><Text style={styles.countText}>{submissions.length}</Text></View> : null}</View>
            {submissions.length ? submissions.map(item => <PendingCard key={item.id} submission={item} onOpen={openReview} />) : (
              <View style={styles.emptyCard}><Ionicons name="checkmark-circle-outline" size={29} color={colors.success} /><Text style={styles.emptyTitle}>Reviews are up to date</Text><Text style={styles.emptyText}>New educator submissions will appear here.</Text></View>
            )}

            <Text style={[styles.sectionTitle, styles.riskHeading]}>Requirements & expiry</Text>
            {risks.length ? risks.map(item => (
              <RequirementCard
                key={item.id}
                credential={item}
                focused={item.id === route?.params?.credentialId || (!route?.params?.credentialId && firstRelation(item.staff)?.id === route?.params?.staffMemberId)}
                reminding={remindingId === item.id}
                reminded={remindedIds.includes(item.id)}
                onRemind={confirmReminder}
              />
            )) : (
              <View style={styles.emptyCard}><Ionicons name="shield-checkmark-outline" size={29} color={colors.success} /><Text style={styles.emptyTitle}>No expiry risks</Text><Text style={styles.emptyText}>Active credentials are valid beyond the next 30 days.</Text></View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={() => !busy && setSelected(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => !busy && setSelected(null)} />
          <View style={styles.modalCard}>
            <View style={styles.grabber} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleCopy}><Text style={styles.modalTitle}>Review renewal</Text><Text style={styles.modalSub}>{selected?.staff?.profile?.full_name} · {selected?.credential?.name}</Text></View>
              <TouchableOpacity onPress={() => !busy && setSelected(null)} style={styles.closeButton} accessibilityLabel="Close review"><Ionicons name="close" size={20} color={colors.textMuted} /></TouchableOpacity>
            </View>

            <View style={styles.detailCard}>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Issuer</Text><Text style={styles.detailValue}>{selected?.issuer}</Text></View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Valid</Text><Text style={styles.detailValue}>{selected ? `${format(parseISO(selected.completed_on), 'MMM d, yyyy')} – ${format(parseISO(selected.expires_on), 'MMM d, yyyy')}` : ''}</Text></View>
              {selected?.credential_number ? <><View style={styles.detailDivider} /><View style={styles.detailRow}><Text style={styles.detailLabel}>Number</Text><Text style={styles.detailValue}>{selected.credential_number}</Text></View></> : null}
            </View>

            {Boolean(firstRelation(selected?.staff)?.background_check_required)
              && isBackgroundCredential(firstRelation(selected?.credential)) ? (
              <View style={styles.ratioImpactCard}>
                <Ionicons name="people-outline" size={19} color={colors.success} />
                <Text style={styles.ratioImpactText}>
                  Approval restores this educator’s staffing-ratio eligibility immediately.
                </Text>
              </View>
            ) : null}

            <TouchableOpacity style={styles.documentButton} onPress={openDocument} disabled={openingDocument} accessibilityRole="button">
              {openingDocument ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="document-text-outline" size={19} color={colors.primary} />}
              <Text style={styles.documentText}>{openingDocument ? 'Opening…' : 'Open submitted document'}</Text>
              <Ionicons name="open-outline" size={17} color={colors.primary} />
            </TouchableOpacity>

            <Text style={styles.notesLabel}>Correction note</Text>
            <TextInput
              value={reviewNotes}
              onChangeText={value => { setReviewNotes(value); setNotesError(''); }}
              placeholder="Required only when requesting changes"
              placeholderTextColor={colors.textFaint}
              multiline
              style={[styles.notesInput, notesError && styles.notesInputError]}
              accessibilityLabel="Credential correction note"
            />
            {notesError ? <Text style={styles.notesError}>{notesError}</Text> : null}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.rejectButton} onPress={() => saveDecision('rejected')} disabled={busy} accessibilityRole="button"><Text style={styles.rejectText}>Request changes</Text></TouchableOpacity>
              <TouchableOpacity style={styles.approveButton} onPress={approve} disabled={busy} accessibilityRole="button">{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.approveText}>Approve</Text>}</TouchableOpacity>
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
  summaryIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surface },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  summaryText: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, color: colors.danger, fontFamily: fonts.bold, fontSize: 12 },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.successLight },
  infoText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18 },
  countBadge: { minWidth: 23, height: 23, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, borderRadius: radius.full, backgroundColor: colors.amberLight },
  countText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 11 },
  pendingCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  avatar: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.primaryLight },
  avatarText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  cardCopy: { flex: 1, minWidth: 0 },
  staffName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  credentialName: { marginTop: 2, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5 },
  cardMeta: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  reviewBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.amberLight },
  reviewBadgeText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 9.5 },
  riskHeading: { marginTop: spacing.xl, marginBottom: spacing.md },
  riskCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  riskCardFocused: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  riskIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  riskIconExpired: { backgroundColor: colors.dangerLight },
  riskIconSoon: { backgroundColor: colors.amberLight },
  dangerText: { color: colors.danger },
  ratioWarning: { marginTop: 4, color: colors.danger, fontFamily: fonts.bold, fontSize: 10.5 },
  remindButton: { minWidth: 72, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  remindText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 10.5 },
  remindedButton: { backgroundColor: colors.successLight },
  remindedText: { color: colors.success },
  emptyCard: { alignItems: 'center', padding: spacing.xxl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  emptyTitle: { marginTop: spacing.sm, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  emptyText: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  loader: { paddingVertical: 60 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,.35)' },
  modalDismiss: { flex: 1 },
  modalCard: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
  grabber: { alignSelf: 'center', width: 42, height: 5, marginBottom: spacing.lg, borderRadius: 3, backgroundColor: colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.lg },
  modalTitleCopy: { flex: 1 },
  modalTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  modalSub: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.primarySoft },
  detailCard: { paddingHorizontal: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  detailRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detailLabel: { width: 62, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  detailValue: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12, textAlign: 'right' },
  detailDivider: { height: 1, backgroundColor: colors.borderSoft },
  ratioImpactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.successLight,
  },
  ratioImpactText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  documentButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  documentText: { flex: 1, color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  notesLabel: { marginBottom: spacing.xs, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  notesInput: { minHeight: 82, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 13, textAlignVertical: 'top', backgroundColor: colors.bg },
  notesInputError: { borderColor: colors.danger },
  notesError: { marginTop: spacing.xs, color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  rejectButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#E9BFC0', borderRadius: radius.md, backgroundColor: colors.surface },
  rejectText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12.5 },
  approveButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  approveText: { color: colors.white, fontFamily: fonts.bold, fontSize: 12.5 },
});
