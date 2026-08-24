import React, { useMemo } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoadingScreen } from '../../components/ui';
import { credentialAttention, useCredentials } from '../../hooks/useCredentials';
import { colors, fonts, radius, spacing } from '../../theme';

function statusPresentation(credential) {
  const submission = credential.latestSubmission;
  if (submission?.status === 'rejected') {
    return { label: 'Changes requested', tone: 'danger', icon: 'alert-circle-outline' };
  }
  if (submission?.status === 'pending') {
    return { label: 'Awaiting verification', tone: 'amber', icon: 'time-outline' };
  }
  if (credential.status === 'missing') {
    return { label: 'Needed — not on file', tone: 'danger', icon: 'warning-outline' };
  }
  if (credential.status === 'expired') {
    return { label: 'Expired', tone: 'danger', icon: 'warning-outline' };
  }
  if (credential.status === 'expiring') {
    return {
      label: credential.daysUntilExpiry === 0
        ? 'Expires today'
        : `Expires in ${credential.daysUntilExpiry} days`,
      tone: 'amber',
      icon: 'medical-outline',
    };
  }
  return {
    label: credential.expiresOn ? `Valid · ${monthYear(credential.expiresOn)}` : 'Valid',
    tone: 'success',
    icon: 'shield-checkmark-outline',
  };
}

function monthYear(value) {
  if (!value) return '';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short', year: 'numeric',
  });
}

function CredentialRow({ credential, isLast, onPress }) {
  const status = statusPresentation(credential);
  const statusColor = status.tone === 'danger'
    ? colors.danger
    : status.tone === 'amber'
      ? colors.amber
      : colors.success;
  return (
    <TouchableOpacity
      style={[styles.row, !isLast && styles.rowBorder]}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${credential.name}. ${status.label}`}
    >
      <View style={[styles.rowIcon, styles[`${status.tone}Icon`]]}>
        <Ionicons
          name={status.icon}
          size={20}
          color={statusColor}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{credential.name}</Text>
        <View style={[styles.statusPill, styles[`${status.tone}Pill`]]}>
          <Text style={[styles.statusText, styles[`${status.tone}Text`]]}>{status.label}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

export default function CredentialsScreen({ navigation }) {
  const { data, credentials, loading, refreshing, error, refresh, load } = useCredentials();
  const attention = useMemo(() => credentialAttention(credentials), [credentials]);

  if (loading && !data) return <LoadingScreen />;

  const openCredential = (credential) => {
    navigation.navigate('CredentialDetail', { credentialId: credential.id, credential });
  };
  const renewCredential = (credential) => {
    navigation.navigate('CredentialRenewal', { credentialId: credential.id, credential });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Credentials</Text>
        </View>

        {error && (
          <TouchableOpacity style={styles.errorCard} onPress={() => load()} activeOpacity={0.75}>
            <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Credentials could not be loaded</Text>
              <Text style={styles.errorText}>Tap to try again.</Text>
            </View>
          </TouchableOpacity>
        )}

        {attention && (
          <View style={styles.attentionCard}>
            <View style={styles.attentionIcon}>
              <Ionicons name="alert-outline" size={20} color={colors.amber} />
            </View>
            <View style={styles.attentionCopy}>
              <Text style={styles.attentionTitle}>
                {attention.latestSubmission?.status === 'rejected'
                  ? `${attention.name} needs a correction`
                  : attention.status === 'missing'
                    ? `${attention.name} is required`
                    : attention.status === 'expired'
                      ? `${attention.name} has expired`
                      : `${attention.name} expires in ${attention.daysUntilExpiry} days`}
              </Text>
              <Text style={styles.attentionText}>
                {attention.ratioQualifying
                  ? 'Renew to stay ratio-qualified.'
                  : attention.latestSubmission?.status === 'rejected'
                    ? 'Review your director’s note and submit a clearer document.'
                    : 'Upload the document for director verification.'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => renewCredential(attention)}
              accessibilityRole="button"
              accessibilityLabel={`Renew ${attention.name}`}
            >
              <Text style={styles.renewLink}>
                {attention.latestSubmission?.status === 'rejected' ? 'Fix' : 'Renew'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {credentials.length === 0 && !error ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons name="shield-checkmark-outline" size={28} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No credentials assigned yet</Text>
            <Text style={styles.emptyText}>
              Your director will add required certificates and clearances here.
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {credentials.map((credential, index) => (
              <CredentialRow
                key={credential.id}
                credential={credential}
                isLast={index === credentials.length - 1}
                onPress={() => openCredential(credential)}
              />
            ))}
          </View>
        )}

        <Text style={styles.footnote}>
          Your director sees these in the console. Renewals are verified before an expiry reminder clears.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backButton: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 23, lineHeight: 29, fontFamily: fonts.black, color: colors.textPrimary },
  attentionCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.amberLight, borderWidth: 1.5, borderColor: '#EFD9B5',
    borderRadius: 18, padding: spacing.lg,
  },
  attentionIcon: {
    width: 38, height: 38, borderRadius: radius.md, backgroundColor: '#F6E4C0',
    alignItems: 'center', justifyContent: 'center',
  },
  attentionCopy: { flex: 1, minWidth: 0 },
  attentionTitle: { fontSize: 14, lineHeight: 19, fontFamily: fonts.bold, color: colors.textPrimary },
  attentionText: { marginTop: 2, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: '#8A6D3B' },
  renewLink: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
  listCard: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 18, paddingHorizontal: spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 15 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.primarySoft },
  rowIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.textPrimary },
  statusPill: { alignSelf: 'flex-start', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, marginTop: 5 },
  statusText: { fontSize: 11.5, fontFamily: fonts.bold },
  successIcon: { backgroundColor: colors.successLight },
  successPill: { backgroundColor: colors.successLight },
  successText: { color: colors.success },
  amberIcon: { backgroundColor: colors.amberLight },
  amberPill: { backgroundColor: colors.amberLight },
  amberText: { color: colors.amber },
  dangerIcon: { backgroundColor: colors.dangerLight },
  dangerPill: { backgroundColor: colors.dangerLight },
  dangerText: { color: colors.danger },
  emptyCard: {
    alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: 18, padding: spacing.xxl,
  },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.md, fontSize: 16, fontFamily: fonts.bold, color: colors.textPrimary },
  emptyText: { marginTop: spacing.sm, textAlign: 'center', fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, color: colors.textMuted },
  errorCard: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.dangerLight, borderRadius: 14, padding: spacing.lg },
  errorCopy: { flex: 1 },
  errorTitle: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.danger },
  errorText: { marginTop: 2, fontSize: 12, fontFamily: fonts.regular, color: colors.textMuted },
  footnote: { textAlign: 'center', fontSize: 12, lineHeight: 18, fontFamily: fonts.regular, color: colors.textFaint, paddingHorizontal: spacing.md },
});
