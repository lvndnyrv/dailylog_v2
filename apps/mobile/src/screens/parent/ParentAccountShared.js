import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radius, spacing } from '../../theme';

export function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join('').toUpperCase();
}

export function ParentAccountHeader({ navigation, title, subtitle }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={styles.headerCopy}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function AccountIcon({ name, tone = 'blue' }) {
  const palette = tone === 'amber'
    ? { backgroundColor: colors.amberLight, color: colors.amber }
    : tone === 'danger'
      ? { backgroundColor: colors.dangerLight, color: colors.danger }
      : { backgroundColor: colors.primarySoft, color: colors.primary };
  return (
    <View style={[styles.icon, { backgroundColor: palette.backgroundColor }]}>
      <Ionicons name={name} size={19} color={palette.color} />
    </View>
  );
}

export function LoadingCard() {
  return (
    <View style={styles.loadingCard}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.loadingText}>Loading…</Text>
    </View>
  );
}

export function ErrorCard({ message, onRetry }) {
  return (
    <View style={styles.errorCard}>
      <Ionicons name="cloud-offline-outline" size={24} color={colors.danger} />
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  backButton: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21 },
  headerSubtitle: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12,
    marginTop: 2,
  },
  icon: {
    width: 38, height: 38, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  loadingCard: {
    minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.xl,
  },
  loadingText: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12.5 },
  errorCard: {
    alignItems: 'center', padding: spacing.xl, gap: spacing.sm,
    backgroundColor: colors.dangerLight, borderRadius: radius.xl,
  },
  errorText: {
    color: colors.danger, fontFamily: fonts.regular, fontSize: 13,
    textAlign: 'center', lineHeight: 19,
  },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
});
