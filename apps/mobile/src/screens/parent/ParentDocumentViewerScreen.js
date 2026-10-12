import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { Button } from '../../components/ui';
import { useParentDocuments } from '../../hooks/useParentDocuments';
import { colors, fonts, radius, spacing } from '../../theme';
import { ParentAccountHeader } from './ParentAccountShared';

function dateLabel(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function sizeLabel(value) {
  if (!value) return 'PDF';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status) {
  return {
    signed: 'Signed', submitted: 'Submitted', verified: 'Verified', uploaded: 'On file',
    on_file: 'On file', accepted: 'Accepted',
  }[status] || 'On file';
}

function DetailRow({ label, value, last }) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={3}>{value || '—'}</Text>
    </View>
  );
}

function Preview({ record, child, daycare }) {
  const data = record.structured_data || {};
  if (record.source_type === 'health_summary') {
    return (
      <View style={styles.healthPreview}>
        <View style={styles.healthHeader}>
          <View style={styles.healthIcon}><Ionicons name="medkit-outline" size={22} color={colors.success} /></View>
          <View style={styles.flexOne}>
            <Text style={styles.previewHeading}>{child.first_name}'s current health record</Text>
            <Text style={styles.previewSub}>{daycare?.name}</Text>
          </View>
        </View>
        <DetailRow label="Allergies" value={(data.allergies || []).join(', ') || 'None recorded'} />
        <DetailRow label="Medical notes" value={data.medical_notes || 'None recorded'} last />
      </View>
    );
  }
  return (
    <View style={styles.documentPreview}>
      <Text style={styles.previewHeading}>{record.source_type === 'agreement' ? `${daycare?.name} — Enrollment Agreement` : record.title}</Text>
      {[92, 100, 84, 96, 60, 90, 100, 72].map((width, index) => (
        <View key={`${width}-${index}`} style={[styles.previewLine, { width: `${width}%` }, index === 5 && { marginTop: 7 }]} />
      ))}
      <View style={styles.pageBadge}><Text style={styles.pageBadgeText}>{record.storage_path ? 'Secure file' : 'Family record'}</Text></View>
    </View>
  );
}

export default function ParentDocumentViewerScreen({ navigation, route }) {
  const recordId = route.params?.recordId || route.params?.record?.id;
  const sourceType = route.params?.sourceType || route.params?.record?.source_type;
  const childId = route.params?.childId || route.params?.child?.id;
  const {
    hub, loading, error: loadError, refresh, shareRecord,
  } = useParentDocuments();
  const [busy, setBusy] = useState('');

  useFocusEffect(useCallback(() => {
    refresh().catch(() => {});
  }, [refresh]));

  const resolved = useMemo(() => {
    const children = hub?.children || [];
    const candidates = childId
      ? [...children.filter((item) => item.id === childId), ...children.filter((item) => item.id !== childId)]
      : children;
    for (const candidateChild of candidates) {
      const candidateRecord = (candidateChild.records || []).find((item) => (
        item.id === recordId && (!sourceType || item.source_type === sourceType)
      ));
      if (candidateRecord) return { child: candidateChild, record: candidateRecord };
    }
    return { child: null, record: null };
  }, [childId, hub, recordId, sourceType]);
  const { child, record } = resolved;
  const daycare = hub?.daycare;
  const profile = hub?.profile;

  async function act(mode) {
    setBusy(mode);
    try {
      await shareRecord({ record, child, daycare, profile }, mode);
    } catch (error) {
      Alert.alert('Could not prepare document', error.message || 'Please try again.');
    } finally {
      setBusy('');
    }
  }

  if (loading && !hub) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ParentAccountHeader navigation={navigation} title="Document" />
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (loadError && !hub) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ParentAccountHeader navigation={navigation} title="Document" />
        <View style={styles.center}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Button label="Try again" onPress={() => refresh().catch(() => {})} style={styles.retryButton} />
        </View>
      </SafeAreaView>
    );
  }

  if (!record || !child) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ParentAccountHeader navigation={navigation} title="Document" />
        <View style={styles.center}>
          <View style={styles.unavailableIcon}><Ionicons name="document-outline" size={32} color={colors.primary} /></View>
          <Text style={styles.unavailableTitle}>Document no longer available</Text>
          <Text style={styles.unavailableText}>It may have been replaced or removed from the family record by the office.</Text>
          <Button label="Back to Documents" onPress={() => navigation.navigate('ParentDocuments', { childId })} style={styles.retryButton} />
        </View>
      </SafeAreaView>
    );
  }

  const signedBy = record.structured_data?.signature_name || profile?.full_name;
  const format = record.mime_type === 'application/pdf' ? 'PDF' : 'Secure file';
  const fileMeta = record.size_bytes
    ? `${format} · ${sizeLabel(record.size_bytes)}`
    : `${format} · generated from your family record`;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ParentAccountHeader navigation={navigation} title={record.title} subtitle={fileMeta} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} tintColor={colors.primary} />}
      >
        {loadError ? (
          <TouchableOpacity style={styles.syncWarning} onPress={() => refresh().catch(() => {})}>
            <Ionicons name="cloud-offline-outline" size={17} color={colors.amber} />
            <Text style={styles.syncWarningText}>Could not refresh this document. Tap to try again.</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.statusRow}>
          <View style={styles.fileIdentity}>
            <View style={styles.fileIcon}><Ionicons name="document-text-outline" size={22} color={colors.success} /></View>
            <View style={styles.flexOne}>
              <Text style={styles.fileTitle}>{record.title}</Text>
              <Text style={styles.fileMeta}>{child.first_name} {child.last_name} · {dateLabel(record.recorded_at)}</Text>
            </View>
          </View>
          <View style={styles.signedBadge}><Ionicons name="checkmark" size={13} color={colors.success} /><Text style={styles.signedText}>{statusLabel(record.status)}</Text></View>
        </View>

        <Preview record={record} child={child} daycare={daycare} />

        <View style={styles.detailsCard}>
          {record.source_type === 'agreement' ? <DetailRow label="Signed by" value={signedBy} /> : null}
          <DetailRow label="Date" value={dateLabel(record.recorded_at)} />
          <DetailRow label="Reference" value={record.reference || `DL-DOC-${String(record.id).slice(0, 8).toUpperCase()}`} last />
        </View>

        <View style={styles.actionRow}>
          <Button label="Download" onPress={() => act('download')} loading={busy === 'download'} disabled={Boolean(busy)} style={styles.downloadButton} />
          <TouchableOpacity style={styles.shareButton} onPress={() => act('share')} disabled={Boolean(busy)} accessibilityLabel={`Share ${record.title}`}>
            <Ionicons name="share-outline" size={19} color={colors.textPrimary} />
            <Text style={styles.shareText}>Share</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.securityNote}>
          <Ionicons name="lock-closed-outline" size={17} color={colors.primary} />
          <Text style={styles.securityText}>Stored securely with {child.first_name}'s record. Shared copies leave DailyLog's protected storage.</Text>
        </View>
        <TouchableOpacity
          style={styles.messageLink}
          onPress={() => navigation.navigate('ParentTabs', { screen: 'MessagesTab' })}
        >
          <Ionicons name="chatbubble-outline" size={17} color={colors.primary} />
          <Text style={styles.messageText}>Need a change? Message the office</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { paddingHorizontal: 24, paddingBottom: 44, gap: spacing.lg },
  flexOne: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fileIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fileIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  fileTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14 },
  fileMeta: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  signedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successLight, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full },
  signedText: { color: colors.success, fontFamily: fonts.bold, fontSize: 10.5 },
  documentPreview: {
    height: 250, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 16, padding: spacing.xl, gap: 9, overflow: 'hidden', position: 'relative',
  },
  healthPreview: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
  healthHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  healthIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  previewHeading: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 13.5 },
  previewSub: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  previewLine: { height: 7, borderRadius: 4, backgroundColor: colors.primarySoft },
  pageBadge: { position: 'absolute', bottom: 12, right: 14, backgroundColor: colors.bg, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  pageBadgeText: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 10.5 },
  detailsCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: 16, paddingHorizontal: spacing.lg },
  detailRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, paddingVertical: spacing.sm },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5 },
  detailValue: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5, textAlign: 'right' },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  downloadButton: { flex: 1 },
  shareButton: { minWidth: 110, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md },
  shareText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  securityNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.primaryLight, borderRadius: radius.lg },
  securityText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
  messageLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  messageText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  syncWarning: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.amberLight, borderRadius: radius.lg },
  syncWarningText: { flex: 1, color: colors.amber, fontFamily: fonts.bold, fontSize: 11.5 },
  errorText: { color: colors.danger, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
  retryButton: { marginTop: spacing.lg, minWidth: 210 },
  unavailableIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  unavailableTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21, textAlign: 'center' },
  unavailableText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: spacing.sm, maxWidth: 320 },
});
