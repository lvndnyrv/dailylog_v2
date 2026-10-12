import React, { useCallback } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useParentBilling } from '../../hooks/useParentBilling';
import { colors, fonts, radius, spacing } from '../../theme';
import {
  isPaymentMethodExpired, money, monthLabel, ScreenHeader, sharedStyles, shortDate,
} from './ParentBillingShared';

function dueCopy(dueOn) {
  if (!dueOn) return 'No payment due';
  const due = new Date(`${dueOn}T12:00:00Z`);
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.ceil((due.getTime() - todayUtc) / 86400000);
  if (days < 0) return `Due ${shortDate(dueOn)} · overdue`;
  if (days === 0) return `Due ${shortDate(dueOn)} · today`;
  return `Due ${shortDate(dueOn)} · in ${days} day${days === 1 ? '' : 's'}`;
}

function InvoiceRow({ invoice, onPress }) {
  const paid = invoice.balance_cents === 0;
  const summary = invoice.summary || 'Tuition';
  const room = invoice.classroom_name || '';
  const detail = room && !summary.toLowerCase().includes(room.toLowerCase())
    ? `${summary} · ${room}`
    : summary;
  return (
    <TouchableOpacity style={styles.invoiceRow} onPress={onPress} activeOpacity={0.72}>
      <View style={styles.invoiceIcon}>
        <Ionicons name="document-text-outline" size={19} color={colors.textFaint} />
      </View>
      <View style={styles.invoiceCopy}>
        <Text style={styles.invoiceTitle}>{monthLabel(invoice.issued_on)}</Text>
        <Text style={styles.invoiceSubtitle} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <View style={styles.invoiceAmountCopy}>
        <Text style={styles.invoiceAmount}>{money(invoice.total_cents, invoice.currency)}</Text>
        <Text style={[styles.statusBadge, paid ? styles.statusPaid : styles.statusDue]}>
          {paid ? 'Paid' : invoice.status === 'overdue' ? 'Overdue' : 'Due'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function BillingHomeScreen({ navigation }) {
  const { home, loading, error, refresh } = useParentBilling();

  useFocusEffect(useCallback(() => {
    refresh().catch(() => {});
  }, [refresh]));

  const invoices = home?.invoices || [];
  const payableInvoices = invoices
    .filter((invoice) => invoice.balance_cents > 0 && ['open', 'overdue'].includes(invoice.status))
    .sort((left, right) => String(left.due_on || '').localeCompare(String(right.due_on || '')));
  const payable = payableInvoices[0];
  const preferences = home?.preferences || {};
  const methods = home?.payment_methods || [];
  const defaultMethod = methods.find((method) => method.id === preferences.default_payment_method_id);
  const autopayNeedsAttention = Boolean(preferences.autopay_enabled)
    && (!defaultMethod || isPaymentMethodExpired(defaultMethod));
  const balance = home?.current_balance_cents || 0;

  return (
    <SafeAreaView style={sharedStyles.safeArea} edges={['top']}>
      <ScreenHeader navigation={navigation} title="Billing" subtitle={home?.family_name} />
      <ScrollView
        contentContainerStyle={sharedStyles.content}
        refreshControl={<RefreshControl refreshing={loading && Boolean(home)} onRefresh={() => refresh().catch(() => {})} tintColor={colors.primary} />}
      >
        {!home && loading ? <ActivityIndicator style={styles.loader} size="large" color={colors.primary} /> : null}
        {error && !home ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
            <View style={styles.errorCopy}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => refresh().catch(() => {})}><Text style={styles.retry}>Try again</Text></TouchableOpacity>
            </View>
          </View>
        ) : null}

        {home ? (
          <>
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Current balance</Text>
              <Text style={styles.balanceAmount}>{money(balance)}</Text>
              <Text style={[styles.dueText, balance === 0 && styles.settledText]}>
                {balance > 0 ? dueCopy(home.next_due_on) : 'Your account is paid in full'}
              </Text>
              <TouchableOpacity
                style={[styles.payButton, !payable && styles.payButtonDisabled]}
                disabled={!payable}
                onPress={() => navigation.navigate('ParentInvoice', { invoiceId: payable.id })}
                accessibilityHint={payableInvoices.length > 1 ? 'Opens the oldest unpaid invoice first' : undefined}
              >
                <Text style={styles.payButtonText}>
                  {payableInvoices.length > 1 ? `Review ${payableInvoices.length} invoices` : payable ? 'Pay now' : 'Nothing due'}
                </Text>
              </TouchableOpacity>
              {payableInvoices.length > 1 ? (
                <Text style={styles.balanceHelp}>This balance spans multiple invoices. The oldest due invoice opens first.</Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={[
                styles.autopayCard,
                !preferences.autopay_enabled && styles.autopayOff,
                autopayNeedsAttention && styles.autopayAttention,
              ]}
              onPress={() => navigation.navigate('ParentPaymentMethods')}
              accessibilityRole="button"
              accessibilityLabel={autopayNeedsAttention ? 'Autopay needs attention. Manage payment methods' : undefined}
            >
              <View style={styles.autopayIcon}>
                <Ionicons
                  name={autopayNeedsAttention ? 'alert-outline' : preferences.autopay_enabled ? 'checkmark' : 'card-outline'}
                  size={18}
                  color={autopayNeedsAttention ? colors.danger : preferences.autopay_enabled ? colors.success : colors.primary}
                />
              </View>
              <Text style={[
                styles.autopayText,
                !preferences.autopay_enabled && styles.autopayOffText,
                autopayNeedsAttention && styles.autopayAttentionText,
              ]} numberOfLines={2}>
                {autopayNeedsAttention
                  ? 'Autopay needs attention · choose a current method'
                  : preferences.autopay_enabled
                  ? `Autopay is on${defaultMethod ? ` · ${defaultMethod.brand} ···· ${defaultMethod.last4}` : ''}`
                  : 'Autopay is off'}
              </Text>
              <Text style={[
                styles.manageText,
                !preferences.autopay_enabled && styles.managePrimary,
                autopayNeedsAttention && styles.autopayAttentionText,
              ]}>Manage</Text>
            </TouchableOpacity>

            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Invoices</Text>
              <TouchableOpacity onPress={() => navigation.navigate('ParentStatements')}>
                <Text style={styles.sectionLink}>Statements & tax</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.invoiceList}>
              {invoices.length ? invoices.map((invoice) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  onPress={() => navigation.navigate('ParentInvoice', { invoiceId: invoice.id })}
                />
              )) : (
                <View style={styles.emptyCard}>
                  <Ionicons name="receipt-outline" size={28} color={colors.textFaint} />
                  <Text style={styles.emptyTitle}>No invoices yet</Text>
                  <Text style={styles.emptyText}>New invoices from your center will appear here.</Text>
                </View>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 80 },
  balanceCard: { marginTop: spacing.sm, backgroundColor: colors.textPrimary, borderRadius: radius.xl, padding: spacing.xl },
  balanceLabel: { color: 'rgba(255,255,255,0.72)', fontFamily: fonts.regular, fontSize: 13 },
  balanceAmount: { color: colors.white, fontFamily: fonts.black, fontSize: 34, marginTop: 4 },
  dueText: { color: '#F0B441', fontFamily: fonts.regular, fontSize: 13, marginTop: 4 },
  settledText: { color: '#A9E3C7' },
  payButton: { minHeight: 48, backgroundColor: colors.surface, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  payButtonDisabled: { opacity: 0.75 },
  payButtonText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  balanceHelp: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: spacing.sm },
  autopayCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.successLight, borderRadius: radius.lg, paddingHorizontal: 15, paddingVertical: spacing.md, marginTop: spacing.lg },
  autopayOff: { backgroundColor: colors.primaryLight },
  autopayAttention: { backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: 'rgba(194,65,65,0.18)' },
  autopayIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  autopayText: { flex: 1, color: '#1B6B45', fontFamily: fonts.bold, fontSize: 13 },
  autopayOffText: { color: colors.textPrimary },
  autopayAttentionText: { color: colors.danger },
  manageText: { color: colors.success, fontFamily: fonts.bold, fontSize: 12.5 },
  managePrimary: { color: colors.primary },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  sectionLink: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  invoiceList: { gap: 9 },
  invoiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primaryLight, borderRadius: radius.lg },
  invoiceIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  invoiceCopy: { flex: 1, minWidth: 0 },
  invoiceTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14.5 },
  invoiceSubtitle: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  invoiceAmountCopy: { alignItems: 'flex-end' },
  invoiceAmount: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14.5 },
  statusBadge: { overflow: 'hidden', borderRadius: radius.full, paddingVertical: 2, paddingHorizontal: 9, marginTop: 3, fontFamily: fonts.bold, fontSize: 11 },
  statusPaid: { color: colors.success, backgroundColor: colors.successLight },
  statusDue: { color: colors.amber, backgroundColor: colors.amberLight },
  emptyCard: { alignItems: 'center', padding: spacing.xxl, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15, marginTop: spacing.sm },
  emptyText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 3 },
  errorCard: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.dangerLight, borderRadius: radius.lg, marginTop: spacing.lg },
  errorCopy: { flex: 1 },
  errorText: { color: colors.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  retry: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13, marginTop: spacing.sm },
});
