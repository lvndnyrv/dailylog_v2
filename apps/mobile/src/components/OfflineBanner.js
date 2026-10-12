import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { colors, fonts, radius, spacing } from '../theme';

export function OfflineBanner() {
  const { user } = useAuth();
  const {
    isOnline,
    pendingCount,
    failedCount,
    syncing,
    retryPending,
    retryFailed,
    discardFailed,
  } = useNetworkStatus(user?.id);

  if (!user || (isOnline && pendingCount === 0 && failedCount === 0)) return null;

  if (failedCount > 0) {
    const confirmDiscard = () => {
      Alert.alert(
        'Discard unsynced changes?',
        `${failedCount} change${failedCount === 1 ? '' : 's'} did not reach the center. Discarding cannot be undone.`,
        [
          { text: 'Keep changes', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: discardFailed },
        ],
      );
    };

    return (
      <View style={[styles.banner, styles.failed]} accessibilityLiveRegion="assertive">
        <View style={styles.messageRow}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text style={[styles.text, styles.failedText]}>
            {failedCount} change{failedCount === 1 ? '' : 's'} need attention and were not synced.
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!isOnline || syncing}
            onPress={retryFailed}
            style={[styles.action, (!isOnline || syncing) && styles.actionDisabled]}
          >
            <Text style={styles.retryText}>{syncing ? 'Retrying…' : isOnline ? 'Retry' : 'Retry when online'}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={confirmDiscard} style={styles.action}>
            <Text style={styles.discardText}>Discard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!isOnline) {
    return (
      <View style={[styles.banner, styles.offline]} accessibilityLiveRegion="polite">
        <View style={styles.messageRow}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.warning} />
          <Text style={styles.text}>
            You&apos;re offline. Changes save on this device and sync when you reconnect
            {pendingCount > 0 ? ` · ${pendingCount} pending` : ''}.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.pending]} accessibilityLiveRegion="polite">
      <View style={styles.messageRow}>
        <Ionicons name="sync-outline" size={18} color={colors.purple} />
        <Text style={styles.text}>
          {syncing ? 'Syncing' : 'Waiting to sync'} {pendingCount} change{pendingCount === 1 ? '' : 's'}.
        </Text>
      </View>
      {!syncing && (
        <TouchableOpacity accessibilityRole="button" onPress={retryPending} style={styles.action}>
          <Text style={styles.retryText}>Retry now</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  offline: { backgroundColor: colors.amberLight, borderBottomColor: '#ECD49C' },
  pending: { backgroundColor: colors.purpleLight, borderBottomColor: '#D8CBF0' },
  failed: { backgroundColor: colors.dangerLight, borderBottomColor: '#F1C1C1' },
  messageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  text: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  failedText: { color: colors.danger },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xs },
  action: { borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  actionDisabled: { opacity: 0.55 },
  retryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  discardText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12 },
});
