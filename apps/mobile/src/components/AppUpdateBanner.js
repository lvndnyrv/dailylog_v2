import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';

import { colors, fonts, radius, spacing } from '../theme';

export function AppUpdateBanner() {
  const { isUpdatePending } = Updates.useUpdates();
  const [restarting, setRestarting] = useState(false);

  if (!isUpdatePending) return null;

  async function applyUpdate() {
    if (restarting) return;
    setRestarting(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setRestarting(false);
    }
  }

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <View style={styles.copy}>
        <Ionicons name="cloud-download-outline" size={18} color={colors.primary} />
        <Text style={styles.text}>A DailyLog update is ready.</Text>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Restart DailyLog to apply update"
        disabled={restarting}
        onPress={applyUpdate}
        style={[styles.action, restarting && styles.disabled]}
      >
        <Text style={styles.actionText}>{restarting ? 'Restarting…' : 'Restart now'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.primaryLight,
  },
  copy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flexShrink: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  action: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm },
  actionText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  disabled: { opacity: 0.55 },
});
