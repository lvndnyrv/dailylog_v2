import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { colors, spacing } from '../theme';

export function OfflineBanner() {
  const { isOnline, pendingCount } = useNetworkStatus();

  // Online and nothing queued — no banner
  if (isOnline && pendingCount === 0) return null;

  if (!isOnline) {
    return (
      <View style={[styles.banner, styles.offline]}>
        <Text style={styles.text}>
          📵  You're offline — changes are saved and will sync when you reconnect
          {pendingCount > 0 ? ` (${pendingCount} pending)` : ''}
        </Text>
      </View>
    );
  }

  // Online with a backlog still syncing
  return (
    <View style={[styles.banner, styles.syncing]}>
      <Text style={styles.text}>
        🔄  Syncing {pendingCount} pending change{pendingCount === 1 ? '' : 's'}…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  offline: { backgroundColor: colors.amber },
  syncing: { backgroundColor: colors.purple },
  text: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
    textAlign: 'center',
  },
});
