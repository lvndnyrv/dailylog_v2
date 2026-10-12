import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';

import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function money(cents = 0) {
  return (Number(cents) / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

function relation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function dateLabel(value) {
  if (!value) return 'No due date';
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? value : format(date, 'MMM d, yyyy');
}

function Metric({ label, value, detail, tone = 'default' }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone === 'danger' && styles.dangerText]}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

export default function AdminBillingScreen({ navigation, route }) {
  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const [invoiceResult, summaryResult] = await Promise.all([
      supabase.from('invoices').select(
        'id, number, status, issued_on, due_on, total_cents, family:families(display_name), child:children(first_name, last_name), billed_to_profile:profiles!invoices_billed_to_fkey(full_name), payments:payments!payments_invoice_id_fkey(id, amount_cents, paid_at)',
      ).order('issued_on', { ascending: false }).limit(60),
      supabase.rpc('get_billing_summary'),
    ]);
    if (invoiceResult.error || summaryResult.error) {
      setError(invoiceResult.error?.message || summaryResult.error?.message || 'Billing could not be loaded.');
    }
    setInvoices(invoiceResult.data || []);
    setSummary(Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const today = new Date().toISOString().slice(0, 10);
  const ordered = useMemo(() => {
    const focusId = route.params?.invoiceId;
    return [...invoices].sort((left, right) => {
      if (left.id === focusId) return -1;
      if (right.id === focusId) return 1;
      const leftOverdue = left.status === 'open' && left.due_on && left.due_on < today;
      const rightOverdue = right.status === 'open' && right.due_on && right.due_on < today;
      return Number(rightOverdue) - Number(leftOverdue);
    });
  }, [invoices, route.params?.invoiceId, today]);

  if (loading && !invoices.length) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Billing</Text>
          <Text style={styles.subtitle}>Invoices, balances and recent payments</Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
      >
        {error ? (
          <TouchableOpacity style={styles.errorCard} onPress={() => load()}>
            <Ionicons name="alert-circle-outline" size={19} color={colors.danger} />
            <Text style={styles.errorText}>{error} Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.metrics}>
          <Metric label="COLLECTED THIS MONTH" value={money(summary?.collected_month_cents)} detail={`of ${money(summary?.expected_month_cents)} invoiced`} />
          <Metric label="OUTSTANDING" value={money(summary?.outstanding_cents)} detail={`${summary?.overdue_count || 0} overdue · ${summary?.open_count || 0} open`} tone={Number(summary?.overdue_count) ? 'danger' : 'default'} />
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={19} color={colors.primary} />
          <Text style={styles.infoText}>Open an invoice to review its history or record a payment. Creating and voiding invoices remain in the admin web app.</Text>
        </View>

        <Text style={styles.sectionTitle}>Invoices</Text>
        {!ordered.length ? (
          <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No invoices yet</Text><Text style={styles.emptyText}>Invoices created for families will appear here.</Text></View>
        ) : ordered.map((invoice) => {
          const family = relation(invoice.family);
          const child = relation(invoice.child);
          const billedTo = relation(invoice.billed_to_profile);
          const overdue = invoice.status === 'open' && invoice.due_on && invoice.due_on < today;
          const focused = invoice.id === route.params?.invoiceId;
          const paid = (invoice.payments || []).reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
          const label = family?.display_name || billedTo?.full_name || 'Family account';
          return (
            <TouchableOpacity key={invoice.id} style={[styles.invoiceCard, focused && styles.invoiceFocused]} onPress={() => navigation.navigate('AdminInvoiceDetail', { invoiceId: invoice.id })} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={`Open invoice ${invoice.number || label}`}>
              <View style={styles.invoiceTop}>
                <View style={[styles.invoiceIcon, overdue ? styles.invoiceIconDanger : styles.invoiceIconBlue]}>
                  <Ionicons name={overdue ? 'alert-outline' : 'receipt-outline'} size={20} color={overdue ? colors.danger : colors.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.familyName}>{label}</Text>
                  <Text style={styles.invoiceNumber}>{invoice.number || 'Invoice'}{child ? ` · ${child.first_name} ${child.last_name}` : ''}</Text>
                </View>
                <Text style={styles.amount}>{money(invoice.total_cents)}</Text>
              </View>
              <View style={styles.invoiceBottom}>
                <Text style={styles.due}>Due {dateLabel(invoice.due_on)}</Text>
                <View style={[styles.status, overdue ? styles.statusDanger : invoice.status === 'paid' ? styles.statusPaid : styles.statusOpen]}>
                  <Text style={[styles.statusText, overdue ? styles.statusTextDanger : invoice.status === 'paid' ? styles.statusTextPaid : styles.statusTextOpen]}>
                    {overdue ? 'Overdue' : invoice.status === 'paid' ? 'Paid' : 'Open'}
                  </Text>
                </View>
              </View>
              {paid > 0 && invoice.status !== 'paid' ? <Text style={styles.paymentText}>{money(paid)} recorded in payments</Text> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 20 },
  headerCopy: { flex: 1 },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21 },
  subtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  content: { padding: spacing.xl, paddingBottom: 44 },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, minHeight: 114, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  metricLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.7 },
  metricValue: { marginTop: spacing.sm, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19 },
  metricDetail: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 14 },
  dangerText: { color: colors.danger },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginVertical: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  infoText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  sectionTitle: { marginBottom: spacing.md, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  errorCard: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
  invoiceCard: { marginBottom: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  invoiceFocused: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  invoiceTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  invoiceIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  invoiceIconBlue: { backgroundColor: colors.primaryLight },
  invoiceIconDanger: { backgroundColor: colors.dangerLight },
  flex: { flex: 1, minWidth: 0 },
  familyName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  invoiceNumber: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  amount: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
  invoiceBottom: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  due: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  status: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full },
  statusDanger: { backgroundColor: colors.dangerLight },
  statusPaid: { backgroundColor: colors.successLight },
  statusOpen: { backgroundColor: colors.primaryLight },
  statusText: { fontFamily: fonts.bold, fontSize: 10.5 },
  statusTextDanger: { color: colors.danger },
  statusTextPaid: { color: colors.success },
  statusTextOpen: { color: colors.primary },
  paymentText: { marginTop: spacing.sm, color: colors.success, fontFamily: fonts.bold, fontSize: 10.5 },
  emptyCard: { alignItems: 'center', padding: spacing.xxl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  emptyText: { marginTop: spacing.xs, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
});
