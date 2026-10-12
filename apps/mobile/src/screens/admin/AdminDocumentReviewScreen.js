import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
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
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function relation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function dateLabel(value) {
  if (!value) return 'Not provided';
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'MMM d, yyyy · h:mm a');
}

export default function AdminDocumentReviewScreen({ navigation, route }) {
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const submissionId = route.params?.submissionId;
    const requestId = route.params?.requestId;
    if (!submissionId && !requestId) {
      setError('This review alert is missing its document reference.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    let query = supabase
      .from('parent_document_submissions')
      .select(`
        id, status, submitted_at, reviewed_at, rejection_reason,
        document:documents(id, title, storage_path, mime_type, size_bytes),
        request:parent_document_requests(
          id, title, kind, message, due_on, status,
          child:children(id, first_name, last_name, photo_url, classroom:classrooms(id, name))
        )
      `);
    query = submissionId
      ? query.eq('id', submissionId)
      : query.eq('request_id', requestId).order('submitted_at', { ascending: false }).limit(1);
    const { data, error: queryError } = await query.maybeSingle();
    setSubmission(data || null);
    setError(queryError?.message || (!data ? 'This document submission is no longer available.' : ''));
    setLoading(false);
  }, [route.params?.requestId, route.params?.submissionId]);

  useEffect(() => { load(); }, [load]);

  const request = relation(submission?.request);
  const child = relation(request?.child);
  const classroom = relation(child?.classroom);
  const document = relation(submission?.document);
  const pending = submission?.status === 'under_review';

  async function openDocument() {
    if (!document?.storage_path) {
      Alert.alert('Document unavailable', 'The uploaded file is not attached to this submission.');
      return;
    }
    setOpening(true);
    const { data, error: signedError } = await supabase.storage
      .from('documents')
      .createSignedUrl(document.storage_path, 10 * 60);
    setOpening(false);
    if (signedError || !data?.signedUrl) {
      Alert.alert('Could not open document', signedError?.message || 'Try again in a moment.');
      return;
    }
    await Linking.openURL(data.signedUrl);
  }

  async function saveDecision(decision) {
    if (decision === 'rejected' && !reason.trim()) {
      setReasonError('Tell the family what needs to be corrected.');
      return;
    }
    setBusy(true);
    const { error: reviewError } = await supabase.rpc('review_parent_document_submission', {
      p_submission_id: submission.id,
      p_decision: decision,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (reviewError) {
      Alert.alert('Could not save review', reviewError.message);
      return;
    }
    showToast(decision === 'accepted' ? 'Family document accepted' : 'Correction requested', 'success');
    await load();
  }

  function approve() {
    Alert.alert(
      'Accept this document?',
      `${request?.title || 'This document'} will be marked complete for ${child?.first_name || 'the child'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept', onPress: () => saveDecision('accepted') },
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
          <Text style={styles.headerTitle}>Document review</Text>
          <Text style={styles.headerSub}>Family upload verification</Text>
        </View>
        <TouchableOpacity onPress={load} style={styles.headerButton} accessibilityLabel="Refresh review">
          <Ionicons name="refresh-outline" size={21} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>Opening secure submission…</Text></View>
      ) : error || !submission ? (
        <View style={styles.state}>
          <Ionicons name="alert-circle-outline" size={35} color={colors.danger} />
          <Text style={styles.stateTitle}>Review unavailable</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={load}><Text style={styles.primaryButtonText}>Try again</Text></TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={[styles.statusCard, pending ? styles.statusPending : styles.statusDone]}>
              <Ionicons name={pending ? 'time-outline' : 'checkmark-circle-outline'} size={23} color={pending ? colors.amber : colors.success} />
              <View style={styles.flex}>
                <Text style={styles.statusTitle}>{pending ? 'Waiting for your decision' : 'This review is complete'}</Text>
                <Text style={styles.statusText}>{pending ? 'Open the uploaded file before accepting or requesting a correction.' : `Current status: ${submission.status.replace('_', ' ')}`}</Text>
              </View>
            </View>

            <View style={styles.childCard}>
              <View style={styles.childAvatar}><Text style={styles.childInitial}>{child?.first_name?.[0] || '?'}</Text></View>
              <View style={styles.flex}>
                <Text style={styles.childName}>{[child?.first_name, child?.last_name].filter(Boolean).join(' ') || 'Child record'}</Text>
                <Text style={styles.childMeta}>{classroom?.name || 'Classroom not assigned'}</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>REQUEST</Text>
            <View style={styles.detailCard}>
              <Text style={styles.documentTitle}>{request?.title || 'Requested family document'}</Text>
              {request?.message ? <Text style={styles.documentMessage}>{request.message}</Text> : null}
              <View style={styles.divider} />
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Uploaded</Text><Text style={styles.detailValue}>{dateLabel(submission.submitted_at)}</Text></View>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>File</Text><Text style={styles.detailValue} numberOfLines={1}>{document?.title || 'Secure upload'}</Text></View>
            </View>

            <TouchableOpacity style={styles.documentButton} onPress={openDocument} disabled={opening} accessibilityRole="button">
              {opening ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="document-text-outline" size={21} color={colors.primary} />}
              <View style={styles.flex}>
                <Text style={styles.documentButtonTitle}>{opening ? 'Opening secure file…' : 'Open uploaded document'}</Text>
                <Text style={styles.documentButtonText}>PDF, JPG or PNG · temporary secure link</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.primary} />
            </TouchableOpacity>

            {pending ? (
              <>
                <Text style={styles.notesLabel}>Correction note</Text>
                <TextInput
                  value={reason}
                  onChangeText={(value) => { setReason(value); setReasonError(''); }}
                  placeholder="Required only when requesting a correction"
                  placeholderTextColor={colors.textFaint}
                  multiline
                  style={[styles.notesInput, reasonError && styles.notesInputError]}
                />
                {reasonError ? <Text style={styles.notesError}>{reasonError}</Text> : null}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.rejectButton} onPress={() => saveDecision('rejected')} disabled={busy}>
                    <Text style={styles.rejectText}>Request correction</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.acceptButton} onPress={approve} disabled={busy}>
                    {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.acceptText}>Accept document</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.goBack()}><Text style={styles.primaryButtonText}>Done</Text></TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
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
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  stateTitle: { marginTop: spacing.md, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  stateText: { marginTop: spacing.sm, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.lg, borderRadius: radius.xl },
  statusPending: { backgroundColor: colors.amberLight },
  statusDone: { backgroundColor: colors.successLight },
  statusTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  statusText: { marginTop: 2, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  childCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  childAvatar: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: colors.primaryLight },
  childInitial: { color: colors.primary, fontFamily: fonts.black, fontSize: 18 },
  childName: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  childMeta: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  sectionLabel: { marginBottom: spacing.sm, color: colors.textMuted, fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 1.3 },
  detailCard: { padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  documentTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  documentMessage: { marginTop: spacing.xs, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  divider: { height: 1, marginVertical: spacing.md, backgroundColor: colors.borderSoft },
  detailRow: { minHeight: 31, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detailLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  detailValue: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12, textAlign: 'right' },
  documentButton: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.xl, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.xl, backgroundColor: colors.primarySoft },
  documentButtonTitle: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13.5 },
  documentButtonText: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  notesLabel: { marginBottom: spacing.xs, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  notesInput: { minHeight: 92, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 13, textAlignVertical: 'top', backgroundColor: colors.surface },
  notesInputError: { borderColor: colors.danger },
  notesError: { marginTop: spacing.xs, color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  rejectButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#E9BFC0', borderRadius: radius.md, backgroundColor: colors.surface },
  rejectText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12 },
  acceptButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  acceptText: { color: colors.white, fontFamily: fonts.bold, fontSize: 12 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
});
