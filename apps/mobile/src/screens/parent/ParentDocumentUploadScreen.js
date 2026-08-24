import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import {
  normalizeParentDocumentAsset, useParentDocuments, validateParentDocumentAsset,
} from '../../hooks/useParentDocuments';
import { colors, fonts, radius, spacing } from '../../theme';
import { ParentAccountHeader } from './ParentAccountShared';

function dateLabel(value) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function fileSize(value) {
  if (!value) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ParentDocumentUploadScreen({ navigation, route }) {
  const { profile } = useAuth();
  const {
    hub, loading, error: loadError, refresh, submitRequest,
  } = useParentDocuments();
  const requestId = route.params?.requestId || route.params?.request?.id;
  const childId = route.params?.childId || route.params?.child?.id;
  const [asset, setAsset] = useState(null);
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const liveChild = useMemo(
    () => (hub?.children || []).find((item) => item.id === childId) || null,
    [childId, hub],
  );
  const liveRequest = useMemo(
    () => (liveChild?.requests || []).find((item) => item.id === requestId) || null,
    [liveChild, requestId],
  );
  const child = liveChild;
  const request = liveRequest;
  const daycareId = hub?.daycare?.id;

  const rejected = request?.status === 'rejected';
  const normalized = useMemo(() => normalizeParentDocumentAsset(asset), [asset]);

  function chooseAsset(nextAsset) {
    const selected = normalizeParentDocumentAsset(nextAsset);
    const validation = validateParentDocumentAsset(selected);
    setAsset(validation ? null : nextAsset);
    setFileError(validation);
  }

  async function chooseFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled && result.assets?.[0]) chooseAsset(result.assets[0]);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings, or choose an existing file instead.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) chooseAsset(result.assets[0]);
  }

  async function send() {
    const validation = validateParentDocumentAsset(normalized);
    if (validation) {
      setFileError(validation);
      return;
    }
    setBusy(true);
    try {
      const saved = await submitRequest({
        request,
        child,
        daycareId,
        userId: profile?.id,
        asset,
      });
      navigation.replace('ParentDocumentSent', {
        request: saved,
        child,
        fileName: normalized.name,
      });
    } catch (error) {
      setFileError(error.message || 'The document could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !hub) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ParentAccountHeader navigation={navigation} title="Document request" />
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (loadError && !hub) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ParentAccountHeader navigation={navigation} title="Document request" />
        <View style={styles.center}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Button label="Try again" onPress={() => refresh().catch(() => {})} style={styles.retryButton} />
        </View>
      </SafeAreaView>
    );
  }

  if (!request || !child || !['requested', 'rejected'].includes(request.status)) {
    const completed = request?.status === 'accepted';
    const reviewing = request?.status === 'under_review';
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ParentAccountHeader navigation={navigation} title="Document request" />
        <View style={styles.center}>
          <View style={styles.unavailableIcon}>
            <Ionicons name={completed ? 'checkmark' : reviewing ? 'time-outline' : 'document-outline'} size={32} color={completed ? colors.success : colors.primary} />
          </View>
          <Text style={styles.unavailableTitle}>{completed ? 'Already on file' : reviewing ? 'The office is reviewing it' : 'Request no longer available'}</Text>
          <Text style={styles.unavailableText}>
            {completed
              ? 'The office has accepted this document. You can find it in your family Documents.'
              : reviewing
                ? 'Your upload was received, so another copy cannot be sent unless the office requests one.'
                : 'This request may have been cancelled or removed by the office.'}
          </Text>
          <Button label="Back to Documents" onPress={() => navigation.navigate('ParentDocuments', { childId })} style={styles.retryButton} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ParentAccountHeader navigation={navigation} title={rejected ? 'Upload another copy' : 'Requested by the office'} subtitle={`${child.first_name}'s private record`} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.requestCard, rejected && styles.rejectedCard]}>
          <Text style={styles.requestTitle}>{request.title}</Text>
          <Text style={[styles.requestMessage, rejected && { color: colors.danger }]}>
            {rejected
              ? request.rejection_reason || 'The office could not accept the previous document. Please upload a clearer or more current copy.'
              : request.message || `Please send the current document for ${child.first_name}.`}
          </Text>
          <View style={styles.dueRow}>
            <Ionicons name={rejected ? 'alert-circle-outline' : 'time-outline'} size={15} color={rejected ? colors.danger : colors.amber} />
            <Text style={[styles.dueText, rejected && { color: colors.danger }]}>
              {rejected ? 'A replacement is needed' : `Due by ${dateLabel(request.due_on)}`}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>ADD THE DOCUMENT</Text>
        <View style={[styles.dropZone, fileError && styles.dropZoneError, normalized && styles.dropZoneSelected]}>
          {normalized ? (
            <>
              <View style={styles.selectedIcon}><Ionicons name="document-text-outline" size={25} color={colors.success} /></View>
              <Text style={styles.selectedName} numberOfLines={2}>{normalized.name}</Text>
              <Text style={styles.dropHint}>{fileSize(normalized.size)} · ready to send</Text>
              <TouchableOpacity onPress={() => { setAsset(null); setFileError(''); }} style={styles.removeButton} accessibilityLabel="Remove selected document">
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.uploadIcon}><Ionicons name="cloud-upload-outline" size={25} color={colors.primary} /></View>
              <Text style={styles.dropTitle}>Choose a clear, complete copy</Text>
              <Text style={styles.dropHint}>PDF, JPG or PNG · up to 10 MB</Text>
            </>
          )}
        </View>
        {fileError ? <Text style={styles.fileError}>{fileError}</Text> : null}

        <View style={styles.sourceRow}>
          <TouchableOpacity style={styles.sourceButton} onPress={takePhoto} disabled={busy} accessibilityLabel="Take document photo">
            <Ionicons name="camera-outline" size={19} color={colors.primary} />
            <Text style={styles.sourceText}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sourceButton} onPress={chooseFile} disabled={busy} accessibilityLabel="Choose document from Files">
            <Ionicons name="folder-open-outline" size={19} color={colors.primary} />
            <Text style={styles.sourceText}>Files</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.privacyNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
          <Text style={styles.privacyText}>Only your linked family and authorized center administrators can access this file.</Text>
        </View>

        <Button label="Send to the office" onPress={send} loading={busy} style={styles.sendButton} />
        {busy ? <View style={styles.uploadingRow}><ActivityIndicator color={colors.primary} /><Text style={styles.uploadingText}>Uploading securely…</Text></View> : null}
        <Text style={styles.footerText}>The office is notified after the upload completes. Leaving this screen before sending does not change your record.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { paddingHorizontal: 24, paddingBottom: 44, gap: spacing.md },
  requestCard: {
    backgroundColor: colors.amberLight, borderWidth: 1.5, borderColor: '#EFD9B5',
    borderRadius: 16, padding: spacing.lg, gap: spacing.xs,
  },
  rejectedCard: { backgroundColor: colors.dangerLight, borderColor: '#E8BEBE' },
  requestTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
  requestMessage: { color: '#8A6D3B', fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dueText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 11.5 },
  sectionLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.75, marginTop: spacing.xs },
  dropZone: {
    minHeight: 148, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong,
    borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    padding: spacing.xl, gap: spacing.sm, position: 'relative',
  },
  dropZoneError: { borderColor: colors.danger, backgroundColor: '#FFF8F8' },
  dropZoneSelected: { borderStyle: 'solid', borderColor: '#B9DDCA', backgroundColor: '#F7FCF9' },
  uploadIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  selectedIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  dropTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  dropHint: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5 },
  selectedName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, textAlign: 'center' },
  removeButton: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  fileError: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5, marginTop: -4 },
  sourceRow: { flexDirection: 'row', gap: spacing.sm },
  sourceButton: {
    flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg,
  },
  sourceText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.primaryLight, borderRadius: radius.lg },
  privacyText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
  sendButton: { marginTop: spacing.xs },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  uploadingText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  footerText: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, textAlign: 'center', paddingHorizontal: spacing.sm },
  errorText: { color: colors.danger, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
  retryButton: { marginTop: spacing.lg, minWidth: 210 },
  unavailableIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  unavailableTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21, textAlign: 'center' },
  unavailableText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: spacing.sm, maxWidth: 320 },
});
