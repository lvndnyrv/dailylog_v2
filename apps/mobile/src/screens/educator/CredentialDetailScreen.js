import React, { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, LoadingScreen } from '../../components/ui';
import { showToast } from '../../components/Toast';
import {
  getCredentialDocumentUrl,
  useCredentials,
  withdrawCredentialSubmission,
} from '../../hooks/useCredentials';
import { colors, fonts, radius, spacing } from '../../theme';

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function StatusBadge({ credential }) {
  const submission = credential.latestSubmission;
  let label = 'Valid';
  let tone = 'success';
  if (submission?.status === 'rejected') {
    label = 'Renewal needs changes'; tone = 'danger';
  } else if (submission?.status === 'pending') {
    label = 'Renewal awaiting verification'; tone = 'amber';
  } else if (credential.status === 'missing') {
    label = 'Needed — not on file'; tone = 'danger';
  } else if (credential.status === 'expired') {
    label = `Expired · ${formatDate(credential.expiresOn)}`; tone = 'danger';
  } else if (credential.status === 'expiring') {
    label = `Expires in ${credential.daysUntilExpiry} days · ${formatDate(credential.expiresOn)}`;
    tone = 'amber';
  } else if (credential.expiresOn) {
    label = `Valid · ${formatDate(credential.expiresOn)}`;
  }
  return (
    <View style={[styles.badge, styles[`${tone}Badge`]]}>
      <View style={[styles.badgeDot, styles[`${tone}Dot`]]} />
      <Text style={[styles.badgeText, styles[`${tone}Text`]]}>{label}</Text>
    </View>
  );
}

function Timeline({ submission, reviewerName }) {
  const isPending = submission?.status === 'pending';
  const isRejected = submission?.status === 'rejected';
  return (
    <View style={styles.timelineCard}>
      <View style={styles.timelineRow}>
        <View style={styles.timelineRail}>
          <View style={[styles.timelineNode, styles.timelineDone]}>
            <Ionicons name="checkmark" size={13} color={colors.success} />
          </View>
          <View style={styles.timelineLine} />
        </View>
        <View style={styles.timelineCopy}>
          <Text style={styles.timelineTitle}>Uploaded by you</Text>
          <Text style={styles.timelineMeta}>
            {new Date(submission.submittedAt).toLocaleString('en-CA', {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })} · new expiry {formatDate(submission.expiresOn)}
          </Text>
        </View>
      </View>
      <View style={styles.timelineRow}>
        <View style={styles.timelineRail}>
          <View style={[
            styles.timelineNode,
            isRejected ? styles.timelineRejected : isPending ? styles.timelinePending : styles.timelineDone,
          ]}>
            {isRejected
              ? <Ionicons name="close" size={13} color={colors.danger} />
              : isPending
                ? <View style={styles.pendingDot} />
                : <Ionicons name="checkmark" size={13} color={colors.success} />}
          </View>
          <View style={styles.timelineLine} />
        </View>
        <View style={styles.timelineCopy}>
          <Text style={styles.timelineTitle}>
            {isRejected ? 'Changes requested' : 'Director verifies'}
          </Text>
          <Text style={[
            styles.timelineMeta,
            isRejected ? styles.dangerText : isPending ? styles.amberText : null,
          ]}>
            {isRejected
              ? `${submission.reviewerName || reviewerName} reviewed this renewal`
              : isPending
                ? `Pending · ${reviewerName}`
                : `Verified by ${submission.reviewerName || reviewerName}`}
          </Text>
        </View>
      </View>
      <View style={styles.timelineRow}>
        <View style={styles.timelineRail}>
          <View style={[styles.timelineNode, !isPending && !isRejected && styles.timelineDone]}>
            {!isPending && !isRejected && <Ionicons name="checkmark" size={13} color={colors.success} />}
          </View>
        </View>
        <View style={styles.timelineCopy}>
          <Text style={styles.timelineTitle}>
            {isRejected ? 'Correction required' : 'Waiting to clear reminder'}
          </Text>
          <Text style={styles.timelineMeta}>
            {isRejected
              ? 'The reminder stays active until a corrected renewal is approved.'
              : `Approval will clear the reminder and mark this credential valid to ${formatDate(submission.expiresOn)}.`}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function CredentialDetailScreen({ navigation, route }) {
  const { data, credentials, loading, refreshing, refresh, load } = useCredentials();
  const [withdrawing, setWithdrawing] = useState(false);
  const credential = credentials.find((item) => item.id === route.params?.credentialId)
    || route.params?.credential;

  const openDocument = useCallback(async (document) => {
    try {
      const url = await getCredentialDocumentUrl(document?.storagePath);
      await Linking.openURL(url);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }, []);

  if (loading && !data) return <LoadingScreen />;
  if (!credential) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundTitle}>Credential unavailable</Text>
          <Button label="Back" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  const submission = credential.latestSubmission;
  const pending = submission?.status === 'pending';
  const rejected = submission?.status === 'rejected';

  async function withdrawAndReplace() {
    setWithdrawing(true);
    try {
      await withdrawCredentialSubmission(submission.id);
      await load({ quiet: true });
      navigation.replace('CredentialRenewal', { credentialId: credential.id, credential });
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setWithdrawing(false);
    }
  }

  function confirmWithdraw() {
    Alert.alert(
      'Replace this renewal?',
      'The pending submission will be withdrawn. Its audit history will remain on file.',
      [
        { text: 'Keep waiting', style: 'cancel' },
        { text: 'Withdraw & replace', style: 'destructive', onPress: withdrawAndReplace },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={2}>{credential.name}</Text>
        </View>

        <StatusBadge credential={credential} />

        {rejected && (
          <View style={styles.rejectedCard}>
            <View style={styles.rejectedHeader}>
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text style={styles.rejectedTitle}>Please correct and resubmit</Text>
            </View>
            <Text style={styles.rejectedNote}>{submission.reviewNotes}</Text>
            <Text style={styles.rejectedBy}>
              {submission.reviewerName || data?.reviewerName || 'Your director'} · {formatDate(submission.reviewedAt?.slice(0, 10))}
            </Text>
          </View>
        )}

        {submission && (pending || rejected) && (
          <Timeline submission={submission} reviewerName={data?.reviewerName || 'your director'} />
        )}

        <Text style={styles.sectionLabel}>CURRENT APPROVED CREDENTIAL</Text>
        <View style={styles.detailCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Issued by</Text>
            <Text style={styles.detailValue}>{credential.issuer || '—'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Completed</Text>
            <Text style={styles.detailValue}>{formatDate(credential.completedOn)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Expires</Text>
            <Text style={[styles.detailValue, credential.status !== 'valid' && styles.amberText]}>
              {credential.expiresOn ? formatDate(credential.expiresOn) : 'No expiry'}
            </Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowLast]}>
            <Text style={styles.detailLabel}>Certificate #</Text>
            <Text style={styles.detailValue}>{credential.credentialNumber || '—'}</Text>
          </View>
        </View>

        <View style={styles.documentSection}>
          <Text style={styles.sectionLabel}>CURRENT DOCUMENT</Text>
          {credential.document ? (
            <TouchableOpacity style={styles.documentCard} onPress={() => openDocument(credential.document)} activeOpacity={0.72}>
              <View style={styles.documentIcon}>
                <Ionicons
                  name={credential.document.mimeType === 'application/pdf' ? 'document-text-outline' : 'image-outline'}
                  size={23}
                  color={colors.primary}
                />
              </View>
              <View style={styles.documentCopy}>
                <Text style={styles.documentName} numberOfLines={1}>{credential.document.title}</Text>
                <Text style={styles.documentMeta}>Private document · tap to open</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.noDocumentCard}>
              <Ionicons name="document-outline" size={25} color={colors.textFaint} />
              <Text style={styles.noDocumentText}>
                {credential.status === 'missing' ? 'No document is on file yet.' : 'Current certificate details are on file; no scan was attached.'}
              </Text>
            </View>
          )}
        </View>

        {pending ? (
          <Button
            label={withdrawing ? 'Withdrawing…' : 'Withdraw & replace'}
            onPress={confirmWithdraw}
            loading={withdrawing}
            variant="ghost"
          />
        ) : (
          <Button
            label={rejected ? 'Fix and resubmit' : credential.status === 'missing' ? 'Upload document' : 'Upload renewal'}
            onPress={() => navigation.navigate('CredentialRenewal', {
              credentialId: credential.id,
              credential,
            })}
          />
        )}

        <Text style={styles.footnote}>
          New uploads go to <Text style={styles.footnoteStrong}>{data?.reviewerName || 'your director'}</Text> to verify. Your current credential stays in place until approval.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 22, lineHeight: 27, fontFamily: fonts.black, color: colors.textPrimary },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: radius.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 12, fontFamily: fonts.bold },
  successBadge: { backgroundColor: colors.successLight, borderColor: '#BFE4D1' },
  successDot: { backgroundColor: colors.success },
  successText: { color: colors.success },
  amberBadge: { backgroundColor: colors.amberLight, borderColor: '#EFD9B5' },
  amberDot: { backgroundColor: colors.amber },
  amberText: { color: colors.amber },
  dangerBadge: { backgroundColor: colors.dangerLight, borderColor: '#F0CCCC' },
  dangerDot: { backgroundColor: colors.danger },
  dangerText: { color: colors.danger },
  rejectedCard: { backgroundColor: colors.dangerLight, borderWidth: 1.5, borderColor: '#F0CCCC', borderRadius: 16, padding: spacing.lg },
  rejectedHeader: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  rejectedTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.danger },
  rejectedNote: { marginTop: spacing.sm, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, color: colors.textPrimary },
  rejectedBy: { marginTop: spacing.sm, fontSize: 11.5, fontFamily: fonts.regular, color: colors.textMuted },
  detailCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: 16, paddingHorizontal: spacing.lg },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.primarySoft },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { fontSize: 13.5, fontFamily: fonts.regular, color: colors.textMuted },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 13.5, fontFamily: fonts.bold, color: colors.textPrimary },
  sectionLabel: { fontSize: 12, letterSpacing: 0.7, fontFamily: fonts.bold, color: colors.textFaint },
  documentSection: { gap: spacing.sm },
  documentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: 15, padding: spacing.lg },
  documentIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  documentCopy: { flex: 1, minWidth: 0 },
  documentName: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.textPrimary },
  documentMeta: { marginTop: 3, fontSize: 11.5, fontFamily: fonts.regular, color: colors.textFaint },
  noDocumentCard: { minHeight: 105, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 15, padding: spacing.lg },
  noDocumentText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textMuted },
  timelineCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: 18, padding: spacing.lg, paddingBottom: spacing.sm },
  timelineRow: { flexDirection: 'row', gap: spacing.md, minHeight: 64 },
  timelineRail: { alignItems: 'center', width: 28 },
  timelineNode: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  timelineDone: { backgroundColor: colors.successLight, borderColor: colors.successLight },
  timelinePending: { backgroundColor: colors.amberLight, borderColor: colors.amberLight },
  timelineRejected: { backgroundColor: colors.dangerLight, borderColor: colors.dangerLight },
  pendingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.amber },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  timelineCopy: { flex: 1, paddingTop: 3 },
  timelineTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  timelineMeta: { marginTop: 3, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.textFaint },
  footnote: { textAlign: 'center', fontSize: 12, lineHeight: 18, fontFamily: fonts.regular, color: colors.textFaint, paddingHorizontal: spacing.md },
  footnoteStrong: { fontFamily: fonts.bold, color: colors.textMuted },
  notFound: { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  notFoundTitle: { textAlign: 'center', fontSize: 20, fontFamily: fonts.bold, color: colors.textPrimary },
});
