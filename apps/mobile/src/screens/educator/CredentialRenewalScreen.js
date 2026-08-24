import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DatePickerField } from '../../components/DatePickerField';
import { Button, Input, LoadingScreen } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { submitCredentialRenewal, useCredentials } from '../../hooks/useCredentials';
import { colors, fonts, radius, spacing } from '../../theme';

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
];

function isoToday() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function yearsFrom(dateString, years = 3) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setFullYear(date.getFullYear() + years);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CredentialRenewalScreen({ navigation, route }) {
  const { user, profile } = useAuth();
  const { data, credentials, loading } = useCredentials();
  const routeCredential = route.params?.credential;
  const credential = credentials.find((item) => item.id === route.params?.credentialId)
    || routeCredential;
  const previous = credential?.latestSubmission?.status === 'rejected'
    ? credential.latestSubmission
    : null;
  const today = useMemo(isoToday, []);
  const [issuer, setIssuer] = useState(previous?.issuer || credential?.issuer || '');
  const [completedOn, setCompletedOn] = useState(previous?.completedOn || today);
  const [expiresOn, setExpiresOn] = useState(previous?.expiresOn || yearsFrom(today));
  const [credentialNumber, setCredentialNumber] = useState(
    previous?.credentialNumber || credential?.credentialNumber || ''
  );
  const [asset, setAsset] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const initializedCredential = useRef(routeCredential?.id || null);

  useEffect(() => {
    if (!credential || initializedCredential.current === credential.id) return;
    const latest = credential.latestSubmission?.status === 'rejected'
      ? credential.latestSubmission
      : null;
    setIssuer(latest?.issuer || credential.issuer || '');
    setCompletedOn(latest?.completedOn || today);
    setExpiresOn(latest?.expiresOn || yearsFrom(today));
    setCredentialNumber(latest?.credentialNumber || credential.credentialNumber || '');
    initializedCredential.current = credential.id;
  }, [credential, today]);

  if (loading && !credential) return <LoadingScreen />;

  async function chooseDocument() {
    setFormError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled) setAsset(result.assets[0]);
    } catch (error) {
      setFormError(error.message || 'The file picker could not be opened.');
    }
  }

  function validationMessage() {
    if (!issuer.trim()) return 'Issued by is required.';
    if (!completedOn) return 'Completion date is required.';
    if (!expiresOn) return 'New expiry date is required.';
    if (expiresOn <= completedOn) return 'New expiry must be after the completion date.';
    if (!asset) return 'A certificate document is required.';
    if (asset.size > 10 * 1024 * 1024) return 'The document must be 10 MB or smaller.';
    return '';
  }

  async function submit() {
    const invalid = validationMessage();
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const submissionId = await submitCredentialRenewal({
        credential,
        staffMemberId: data?.staffMemberId,
        daycareId: profile?.daycare_id,
        userId: user?.id,
        issuer,
        completedOn,
        expiresOn,
        credentialNumber,
        asset,
      });
      navigation.replace('CredentialSubmitted', {
        submissionId,
        credentialId: credential.id,
        credentialName: credential.name,
        reviewerName: data?.reviewerName,
        expiresOn,
      });
    } catch (error) {
      setFormError(error.message || 'The renewal could not be submitted. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={2}>
              {credential?.status === 'missing' ? `Add ${credential?.name}` : `Renew ${credential?.name}`}
            </Text>
          </View>

          {previous && (
            <View style={styles.correctionCard}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <View style={styles.correctionCopy}>
                <Text style={styles.correctionTitle}>Your director requested a correction</Text>
                <Text style={styles.correctionText}>{previous.reviewNotes}</Text>
              </View>
            </View>
          )}

          <View style={styles.credentialCard}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.credentialName}>{credential?.name}</Text>
          </View>

          <Input
            label="Issued by *"
            value={issuer}
            onChangeText={setIssuer}
            placeholder="Canadian Red Cross"
            autoCapitalize="words"
            maxLength={120}
          />

          <DatePickerField
            label="Completed *"
            value={completedOn}
            onChange={setCompletedOn}
            placeholder="Choose completion date"
            minimumDate={new Date(2000, 0, 1)}
            maximumDate={new Date(Date.now() + 86400000)}
          />
          <DatePickerField
            label="New expiry *"
            value={expiresOn}
            onChange={setExpiresOn}
            placeholder="Choose expiry date"
            minimumDate={new Date(`${completedOn || today}T12:00:00`)}
            maximumDate={new Date(new Date().setFullYear(new Date().getFullYear() + 20))}
          />
          <Input
            label="Certificate number (optional)"
            value={credentialNumber}
            onChangeText={setCredentialNumber}
            placeholder="e.g. RC-8841-22"
            autoCapitalize="characters"
            maxLength={80}
          />

          <View style={styles.documentSection}>
            <Text style={styles.sectionLabel}>DOCUMENT *</Text>
            <TouchableOpacity
              style={[styles.uploadCard, asset && styles.uploadCardSelected]}
              onPress={chooseDocument}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={asset ? `Replace ${asset.name}` : 'Choose certificate document'}
            >
              <View style={[styles.uploadIcon, asset && styles.uploadIconSelected]}>
                <Ionicons
                  name={asset ? 'checkmark' : 'cloud-upload-outline'}
                  size={25}
                  color={asset ? colors.success : colors.primary}
                />
              </View>
              <View style={styles.uploadCopy}>
                <Text style={styles.uploadTitle} numberOfLines={1}>
                  {asset?.name || 'Choose a photo or PDF'}
                </Text>
                <Text style={styles.uploadMeta}>
                  {asset
                    ? `${fileSize(asset.size)} · tap to replace`
                    : 'PDF, JPG, PNG or HEIC · 10 MB maximum'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={19} color={colors.primary} />
            <Text style={styles.infoText}>
              {data?.reviewerName || 'Your director'} verifies the document before your expiry reminder clears.
            </Text>
          </View>

          {formError ? (
            <View style={styles.errorCard} accessibilityRole="alert">
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <View style={styles.errorCopy}>
                <Text style={styles.errorTitle}>Couldn’t submit the renewal</Text>
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            </View>
          ) : null}

          <Button
            label={submitting ? 'Uploading securely…' : 'Submit for verification'}
            onPress={submit}
            loading={submitting}
          />
          {formError && (
            <TouchableOpacity onPress={submit} disabled={submitting} accessibilityRole="button">
              <Text style={styles.retryLink}>Review the fields and try again</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  backButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 21, lineHeight: 27, fontFamily: fonts.black, color: colors.textPrimary },
  credentialCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primarySoft, borderRadius: 13, paddingHorizontal: spacing.lg, paddingVertical: 13 },
  credentialName: { flex: 1, fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  correctionCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#F0CCCC', borderRadius: 14, padding: spacing.lg },
  correctionCopy: { flex: 1 },
  correctionTitle: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.danger },
  correctionText: { marginTop: 4, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textPrimary },
  documentSection: { gap: spacing.sm },
  sectionLabel: { fontSize: 12, letterSpacing: 0.7, fontFamily: fonts.bold, color: colors.textFaint },
  uploadCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 92, backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, borderRadius: 15, padding: spacing.lg },
  uploadCardSelected: { borderStyle: 'solid', borderColor: '#BFE4D1', backgroundColor: '#FAFEFC' },
  uploadIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  uploadIconSelected: { backgroundColor: colors.successLight },
  uploadCopy: { flex: 1, minWidth: 0 },
  uploadTitle: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.textPrimary },
  uploadMeta: { marginTop: 4, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular, color: colors.textFaint },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primarySoft, borderRadius: 14, padding: spacing.lg },
  infoText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textSecondary },
  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#F0CCCC', borderRadius: 14, padding: spacing.lg },
  errorCopy: { flex: 1 },
  errorTitle: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.danger },
  errorText: { marginTop: 3, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textPrimary },
  retryLink: { textAlign: 'center', fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
});
