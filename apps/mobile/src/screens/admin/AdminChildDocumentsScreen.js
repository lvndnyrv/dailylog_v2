import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { DatePickerField } from '../../components/DatePickerField';
import { showToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const REQUEST_TYPES = [
  { kind: 'immunization', title: 'Updated immunization record', icon: 'medkit-outline' },
  { kind: 'medical_update', title: 'Updated medical form', icon: 'heart-outline' },
  { kind: 'custody_update', title: 'Custody or pickup authorization', icon: 'people-outline' },
  { kind: 'other', title: 'Other family document', icon: 'document-text-outline' },
];

const STATUS = {
  requested: { label: 'Waiting for family', color: colors.amber, background: colors.amberLight, icon: 'time-outline' },
  under_review: { label: 'Ready to review', color: colors.primary, background: colors.primaryLight, icon: 'document-text-outline' },
  rejected: { label: 'Correction requested', color: colors.danger, background: colors.dangerLight, icon: 'alert-circle-outline' },
  accepted: { label: 'On file', color: colors.success, background: colors.successLight, icon: 'checkmark-circle-outline' },
};

function isoDateAfter(days) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateLabel(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function latestSubmission(request) {
  return [...(request.submissions || [])].sort((a, b) => (
    new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime()
  ))[0] || null;
}

function RequestRow({ request, onReview }) {
  const meta = STATUS[request.status] || STATUS.requested;
  const submission = latestSubmission(request);
  const canOpen = Boolean(submission);
  const subtitle = request.status === 'under_review'
    ? `Uploaded ${dateLabel(submission?.submitted_at) || 'recently'} · open to verify`
    : request.status === 'accepted'
      ? `Accepted ${dateLabel(request.completed_at) || 'recently'}`
      : request.status === 'rejected'
        ? request.rejection_reason || 'The family was asked to upload another copy.'
        : request.due_on
          ? `Due ${dateLabel(request.due_on)}`
          : 'The family has been notified.';

  return (
    <TouchableOpacity
      style={styles.requestRow}
      onPress={() => canOpen && onReview(request, submission)}
      activeOpacity={canOpen ? 0.72 : 1}
      disabled={!canOpen}
      accessibilityRole={canOpen ? 'button' : undefined}
      accessibilityLabel={`${request.title}. ${meta.label}. ${subtitle}`}
    >
      <View style={[styles.requestIcon, { backgroundColor: meta.background }]}> 
        <Ionicons name={meta.icon} size={20} color={meta.color} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.requestTitle}>{request.title}</Text>
        <Text style={styles.requestSubtitle} numberOfLines={2}>{subtitle}</Text>
      </View>
      <View style={styles.rowEnd}>
        <View style={[styles.statusBadge, { backgroundColor: meta.background }]}> 
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        {canOpen ? <Ionicons name="chevron-forward" size={17} color={colors.textFaint} /> : null}
      </View>
    </TouchableOpacity>
  );
}

function NewRequestSheet({ visible, busy, onClose, onSubmit }) {
  const [selected, setSelected] = useState(REQUEST_TYPES[0]);
  const [title, setTitle] = useState(REQUEST_TYPES[0].title);
  const [message, setMessage] = useState('');
  const [dueOn, setDueOn] = useState(isoDateAfter(7));

  function choose(type) {
    setSelected(type);
    setTitle(type.title);
  }

  function close() {
    if (busy) return;
    setSelected(REQUEST_TYPES[0]);
    setTitle(REQUEST_TYPES[0].title);
    setMessage('');
    setDueOn(isoDateAfter(7));
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.modalBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close new request" />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.flex}>
              <Text style={styles.sheetTitle}>Request a family document</Text>
              <Text style={styles.sheetSubtitle}>The family receives an in-app task and can upload securely.</Text>
            </View>
            <TouchableOpacity onPress={close} style={styles.closeButton} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeList}>
            {REQUEST_TYPES.map((type) => {
              const active = selected.kind === type.kind;
              return (
                <TouchableOpacity key={type.kind} style={[styles.typeChip, active && styles.typeChipActive]} onPress={() => choose(type)} accessibilityState={{ selected: active }}>
                  <Ionicons name={type.icon} size={17} color={active ? colors.primary : colors.textMuted} />
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{type.title}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.fieldLabel}>Request title *</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Document name" placeholderTextColor={colors.textFaint} />
          <Text style={styles.fieldLabel}>Message to the family</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            style={[styles.input, styles.messageInput]}
            placeholder="Explain what is needed and why"
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={2000}
          />
          <DatePickerField
            label="Due date"
            value={dueOn}
            onChange={setDueOn}
            minimumDate={new Date()}
            maximumDate={new Date(new Date().setFullYear(new Date().getFullYear() + 1))}
          />

          <TouchableOpacity
            style={[styles.primaryButton, (!title.trim() || busy) && styles.buttonDisabled]}
            onPress={() => onSubmit({ kind: selected.kind, title: title.trim(), message: message.trim(), dueOn })}
            disabled={!title.trim() || busy}
          >
            {busy ? <ActivityIndicator color={colors.white} /> : <><Ionicons name="send-outline" size={18} color={colors.white} /><Text style={styles.primaryButtonText}>Send request</Text></>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function AdminChildDocumentsScreen({ navigation, route }) {
  const suppliedChild = route.params?.child || null;
  const childId = route.params?.childId || suppliedChild?.id;
  const [child, setChild] = useState(suppliedChild);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!childId) {
      setError('This child record could not be identified.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const [childResult, requestResult] = await Promise.all([
      suppliedChild
        ? Promise.resolve({ data: suppliedChild, error: null })
        : supabase.from('children').select('id, first_name, last_name, classroom:classrooms(name)').eq('id', childId).maybeSingle(),
      supabase
        .from('parent_document_requests')
        .select('id, kind, title, message, due_on, status, requested_at, submitted_at, completed_at, rejection_reason, submissions:parent_document_submissions(id, status, submitted_at, reviewed_at, rejection_reason, document:documents(id, title, storage_path, mime_type, size_bytes))')
        .eq('child_id', childId)
        .order('requested_at', { ascending: false }),
    ]);
    setChild(childResult.data || suppliedChild || null);
    setRequests(requestResult.data || []);
    setError(childResult.error?.message || requestResult.error?.message || '');
    setLoading(false);
  }, [childId, suppliedChild]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = useMemo(() => requests.filter((item) => item.status !== 'accepted'), [requests]);
  const completed = useMemo(() => requests.filter((item) => item.status === 'accepted'), [requests]);

  async function createRequest(values) {
    setBusy(true);
    const { error: requestError } = await supabase.rpc('create_parent_document_request', {
      p_child_id: childId,
      p_kind: values.kind,
      p_title: values.title,
      p_message: values.message || null,
      p_due_on: values.dueOn || null,
    });
    setBusy(false);
    if (requestError) {
      Alert.alert('Could not send request', requestError.message);
      return;
    }
    setSheetOpen(false);
    showToast('Document request sent to the family', 'success');
    await load();
  }

  function openReview(request, submission) {
    navigation.navigate('AdminDocumentReview', {
      childId,
      requestId: request.id,
      submissionId: submission?.id,
    });
  }

  const childName = [child?.first_name, child?.last_name].filter(Boolean).join(' ') || 'Child';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Family documents</Text>
          <Text style={styles.headerSubtitle}>{childName}</Text>
        </View>
        <TouchableOpacity onPress={() => setSheetOpen(true)} style={styles.addButton} accessibilityLabel="Request a document">
          <Ionicons name="add" size={21} color={colors.white} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.stateText}>Loading family paperwork…</Text></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={34} color={colors.danger} />
          <Text style={styles.stateTitle}>Documents unavailable</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Ionicons name="folder-open-outline" size={25} color={colors.primary} /></View>
            <View style={styles.flex}>
              <Text style={styles.heroTitle}>Secure family record</Text>
              <Text style={styles.heroText}>Request missing paperwork, follow its status, and verify every family upload from one place.</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>OPEN REQUESTS · {active.length}</Text>
          {active.length ? active.map((request) => <RequestRow key={request.id} request={request} onReview={openReview} />) : (
            <View style={styles.emptyCard}>
              <Ionicons name="checkmark-circle-outline" size={27} color={colors.success} />
              <View style={styles.flex}><Text style={styles.emptyTitle}>No outstanding paperwork</Text><Text style={styles.emptyText}>Use + to request an updated family document.</Text></View>
            </View>
          )}

          {completed.length ? <Text style={styles.sectionLabel}>ON FILE · {completed.length}</Text> : null}
          {completed.map((request) => <RequestRow key={request.id} request={request} onReview={openReview} />)}

          <View style={styles.securityNote}>
            <Ionicons name="shield-checkmark-outline" size={19} color={colors.primary} />
            <Text style={styles.securityText}>Files use short-lived secure links. Only linked family members and authorized center administrators can open them.</Text>
          </View>
        </ScrollView>
      )}

      <NewRequestSheet visible={sheetOpen} busy={busy} onClose={() => setSheetOpen(false)} onSubmit={createRequest} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  header: { minHeight: 66, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, alignItems: 'center' },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18 },
  headerSubtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  addButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  stateTitle: { marginTop: spacing.md, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19 },
  stateText: { marginTop: spacing.sm, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: { marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.full, backgroundColor: colors.primary },
  retryText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  content: { padding: spacing.xl, paddingBottom: 52, gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primarySoft },
  heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  heroTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
  heroText: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  sectionLabel: { marginTop: spacing.md, color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 },
  requestRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  requestIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  requestTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  requestSubtitle: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  rowEnd: { alignItems: 'flex-end', gap: spacing.sm },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.full },
  statusText: { fontFamily: fonts.bold, fontSize: 9.5 },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  emptyText: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  securityNote: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  securityText: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,0.35)' },
  sheet: { maxHeight: '88%', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 34, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
  sheetHandle: { width: 42, height: 4, alignSelf: 'center', marginBottom: spacing.lg, borderRadius: 2, backgroundColor: colors.border },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  sheetTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  sheetSubtitle: { marginTop: 4, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  typeList: { gap: spacing.sm, paddingBottom: spacing.lg },
  typeChip: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  typeChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeChipText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 11.5 },
  typeChipTextActive: { color: colors.primary },
  fieldLabel: { marginBottom: spacing.sm, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  input: { minHeight: 50, marginBottom: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
  messageInput: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  primaryButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.full, backgroundColor: colors.primary },
  buttonDisabled: { opacity: 0.45 },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
});
