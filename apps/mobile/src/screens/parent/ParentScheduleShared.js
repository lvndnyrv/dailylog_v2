import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';

import { colors, fonts, radius, spacing } from '../../theme';

export function scheduleDate(value, pattern = 'EEE, MMM d') {
  if (!value) return '—';
  return format(parseISO(value), pattern);
}

export function scheduleDateRange(startsOn, endsOn) {
  if (!startsOn) return '—';
  if (!endsOn || startsOn === endsOn) return scheduleDate(startsOn, 'EEEE, MMMM d');
  const sameMonth = startsOn.slice(0, 7) === endsOn.slice(0, 7);
  return sameMonth
    ? `${scheduleDate(startsOn, 'MMM d')}–${scheduleDate(endsOn, 'd')}`
    : `${scheduleDate(startsOn, 'MMM d')}–${scheduleDate(endsOn, 'MMM d')}`;
}

export function timeLabel(value) {
  if (!value) return '—';
  const [hourValue, minute] = value.split(':').map(Number);
  const suffix = hourValue >= 12 ? 'PM' : 'AM';
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function money(cents, currency = 'CAD') {
  if (cents == null) return null;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function ScheduleHeader({ navigation, title, close = false }) {
  function leaveScreen() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('ParentTabs', { screen: 'ParentHome' });
  }

  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.back}
        onPress={leaveScreen}
        accessibilityRole="button"
        accessibilityLabel={close ? 'Close' : 'Go back'}
      >
        <Ionicons name={close ? 'close' : 'chevron-back'} size={20} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={2}>{title}</Text>
    </View>
  );
}

export function ScheduleLoading() {
  return (
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>Loading family calendar…</Text>
    </View>
  );
}

export function ScheduleError({ message, onRetry }) {
  return (
    <View style={[styles.stateCard, styles.errorCard]}>
      <Ionicons name="cloud-offline-outline" size={24} color={colors.danger} />
      <Text style={styles.stateTitle}>Could not load this plan</Text>
      <Text style={styles.stateBody}>{message}</Text>
      <TouchableOpacity style={styles.retry} onPress={onRetry}>
        <Text style={styles.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

export function ScheduleEmpty({ icon = 'calendar-outline', title, body, onBack, actionLabel = 'Back to Today' }) {
  return (
    <View style={styles.stateCard}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {onBack ? (
        <TouchableOpacity style={styles.retry} onPress={onBack}>
          <Text style={styles.retryText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export const scheduleStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 44, gap: spacing.lg },
  primaryButton: {
    minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm,
  },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  secondaryLink: {
    alignSelf: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  secondaryLinkText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 13.5 },
  infoCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primaryLight, borderRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  infoText: {
    flex: 1, color: colors.textSecondary, fontFamily: fonts.regular,
    fontSize: 12.5, lineHeight: 18,
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg,
  },
  back: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft,
  },
  headerTitle: {
    flex: 1, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21,
  },
  stateCard: {
    marginHorizontal: spacing.xl, marginTop: spacing.xxxl,
    alignItems: 'center', gap: spacing.sm, padding: spacing.xl,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.xl,
  },
  errorCard: { borderColor: `${colors.danger}44` },
  stateIcon: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  stateTitle: {
    color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15, textAlign: 'center',
  },
  stateBody: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5,
    lineHeight: 18, textAlign: 'center',
  },
  retry: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
});
