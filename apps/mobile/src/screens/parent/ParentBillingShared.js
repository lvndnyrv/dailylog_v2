import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../theme';

export function money(cents, currency = 'CAD', decimals = true) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format((Number(cents) || 0) / 100);
}

export function monthLabel(value) {
  if (!value) return 'Invoice';
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`));
}

export function shortDate(value) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`));
}

export function isPaymentMethodExpired(method, today = new Date()) {
  if (!method || method.method_type !== 'card') return false;
  const month = Number(method.expiry_month);
  const year = Number(method.expiry_year);
  if (!month || !year) return true;
  return year < today.getFullYear()
    || (year === today.getFullYear() && month < today.getMonth() + 1);
}

export function ScreenHeader({ navigation, title, subtitle }) {
  return (
    <View style={sharedStyles.header}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={sharedStyles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={sharedStyles.headerCopy}>
        <Text style={sharedStyles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={sharedStyles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={sharedStyles.backButton} />
    </View>
  );
}

export function PaymentMethodRow({ method, selected, onPress, badge, disabled }) {
  const bank = method.method_type === 'bank';
  const expired = isPaymentMethodExpired(method);
  const testDecline = method.provider === 'demo' && method.last4 === '0002';
  const row = (
    <>
      <View style={[sharedStyles.methodLogo, bank && sharedStyles.bankLogo]}>
        {bank ? (
          <Ionicons name="business-outline" size={17} color={colors.amber} />
        ) : (
          <Text style={sharedStyles.methodLogoText}>{String(method.brand || 'CARD').split(/\s+/)[0].toUpperCase()}</Text>
        )}
      </View>
      <View style={sharedStyles.methodCopy}>
        <Text style={sharedStyles.methodTitle}>
          {bank ? `${method.brand} ···· ${method.last4}` : `···· ${method.last4}`}
        </Text>
        <Text style={[sharedStyles.methodSubtitle, expired && sharedStyles.expiredText]}>
          {expired
            ? 'Expired · update this method'
            : testDecline
            ? `Test decline · expires ${String(method.expiry_month).padStart(2, '0')}/${String(method.expiry_year).slice(-2)}`
            : bank
            ? 'Bank account · no fee'
            : method.expiry_month && method.expiry_year
              ? `Expires ${String(method.expiry_month).padStart(2, '0')}/${String(method.expiry_year).slice(-2)}`
              : method.brand}
        </Text>
      </View>
      {badge ? <Text style={sharedStyles.defaultBadge}>{badge}</Text> : null}
      {selected ? <View style={sharedStyles.radioSelected}><View style={sharedStyles.radioDot} /></View> : null}
    </>
  );

  if (!onPress) return <View style={[sharedStyles.methodRow, selected && sharedStyles.methodRowSelected, expired && sharedStyles.methodRowExpired]}>{row}</View>;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || expired}
      activeOpacity={0.72}
      style={[sharedStyles.methodRow, selected && sharedStyles.methodRowSelected, expired && sharedStyles.methodRowExpired, disabled && sharedStyles.disabled]}
      accessibilityRole="radio"
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
    >
      {row}
    </TouchableOpacity>
  );
}

export const sharedStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight,
  },
  backButton: { width: 42, height: 42, justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0, alignItems: 'center' },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19 },
  headerSubtitle: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  content: { paddingHorizontal: 22, paddingTop: spacing.sm, paddingBottom: 44 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 18,
  },
  methodRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  methodRowSelected: { borderColor: colors.primary },
  methodRowExpired: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  methodLogo: {
    width: 42,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankLogo: { backgroundColor: colors.amberLight },
  methodLogoText: { color: colors.primary, fontFamily: fonts.black, fontSize: 9 },
  methodCopy: { flex: 1, minWidth: 0 },
  methodTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  methodSubtitle: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  expiredText: { color: colors.danger, fontFamily: fonts.bold },
  defaultBadge: {
    color: colors.success,
    fontFamily: fonts.bold,
    fontSize: 11,
    backgroundColor: colors.successLight,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  radioSelected: { width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary },
  disabled: { opacity: 0.55 },
});
