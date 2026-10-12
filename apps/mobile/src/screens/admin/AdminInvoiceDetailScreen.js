import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';

import { showToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const METHODS = ['cash', 'cheque', 'e-transfer', 'card', 'other'];

function relation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function money(cents = 0) {
  return (Number(cents) / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

function dateLabel(value, includeTime = false) {
  if (!value) return 'Not recorded';
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, includeTime ? 'MMM d, yyyy · h:mm a' : 'MMM d, yyyy');
}

function parseAmount(value) {
  const normalized = String(value || '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [dollars, cents = ''] = normalized.split('.');
  return Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
}

function PaymentModal({ visible, balanceCents, busy, onClose, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('e-transfer');
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (!visible) return;
    setAmount((Math.max(0, balanceCents) / 100).toFixed(2));
    setMethod('e-transfer');
    setError('');
  }, [balanceCents, visible]);

  function submit() {
    const cents = parseAmount(amount);
    if (!cents || cents <= 0) {
      setError('Enter a dollar amount such as 780.00.');
      return;
    }
    if (cents > balanceCents) {
      setError(`The remaining balance is ${money(balanceCents)}.`);
      return;
    }
    Alert.alert(
      'Record this payment?',
      `${money(cents)} received by ${method}. This updates the family ledger and cannot be edited from mobile.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Record payment', onPress: () => onSubmit(cents, method) },
      ],
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalCard}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.flex}><Text style={styles.modalTitle}>Record a payment</Text><Text style={styles.modalSubtitle}>Remaining balance {money(balanceCents)}</Text></View>
            <TouchableOpacity onPress={onClose} disabled={busy} style={styles.modalClose} accessibilityLabel="Close payment form"><Ionicons name="close" size={20} color={colors.textPrimary} /></TouchableOpacity>
          </View>
          <Text style={styles.fieldLabel}>Amount received *</Text>
          <View style={[styles.amountInput, error && styles.inputError]}><Text style={styles.currency}>$</Text><TextInput value={amount} onChangeText={(next) => { setAmount(next); setError(''); }} keyboardType="decimal-pad" style={styles.amountField} placeholder="0.00" placeholderTextColor={colors.textFaint} /></View>
          {error ? <Text style={styles.fieldError}>{error}</Text> : null}
          <Text style={styles.fieldLabel}>Payment method *</Text>
          <View style={styles.methodGrid}>
            {METHODS.map(option => (
            <TouchableOpacity key={option} onPress={() => setMethod(option)} style={[styles.methodButton, method === option && styles.methodButtonActive]} accessibilityRole="button" accessibilityState={{ selected: method === option }}>
                <Text style={[styles.methodText, method === option && styles.methodTextActive]}>{option === 'e-transfer' ? 'E-transfer' : option[0].toUpperCase() + option.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton} accessibilityRole="button"><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={submit} disabled={busy} style={[styles.primaryButton, busy && styles.disabledButton]} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Record payment</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function AdminInvoiceDetailScreen({ navigation, route }) {
  const invoiceId = route.params?.invoiceId;
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!invoiceId) {
      setError('This invoice link is incomplete.');
      setLoading(false);
      return;
    }
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase.from('invoices').select(
      'id, number, status, issued_on, due_on, currency, subtotal_cents, total_cents, family:families(id, display_name), child:children(id, first_name, last_name), billed_to_profile:profiles!invoices_billed_to_fkey(id, full_name, email), lines:invoice_lines(id, description, quantity, amount_cents), payments:payments!payments_invoice_id_fkey(id, amount_cents, method, paid_at, status), reminders:invoice_reminder_events(id, sent_at, tone, status)',
    ).eq('id', invoiceId).maybeSingle();
    setInvoice(data || null);
    setError(queryError?.message || (!data ? 'This invoice is unavailable or was removed.' : ''));
    setLoading(false);
    setRefreshing(false);
  }, [invoiceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const payments = useMemo(() => (invoice?.payments || []).filter(payment => payment.status === 'succeeded'), [invoice?.payments]);
  const paidCents = payments.reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
  const balanceCents = Math.max(0, Number(invoice?.total_cents || 0) - paidCents);
  const payable = ['open', 'overdue'].includes(invoice?.status);
  const overdue = Boolean(payable && (invoice?.status === 'overdue' || (invoice?.due_on && invoice.due_on < new Date().toISOString().slice(0, 10))));
  const family = relation(invoice?.family);
  const child = relation(invoice?.child);
  const billedTo = relation(invoice?.billed_to_profile);

  async function recordPayment(amountCents, method) {
    setBusy(true);
    const { error: paymentError } = await supabase.rpc('record_invoice_payment', {
      p_invoice_id: invoice.id,
      p_amount_cents: amountCents,
      p_method: method,
    });
    setBusy(false);
    if (paymentError) {
      Alert.alert('Could not record payment', paymentError.message);
      return;
    }
    setPaymentOpen(false);
    showToast('Payment recorded', 'success');
    await load({ refresh: true });
  }

  if (loading && !invoice) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Go back"><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></TouchableOpacity>
        <View style={styles.flex}><Text style={styles.title}>{invoice?.number || 'Invoice'}</Text><Text style={styles.subtitle}>{family?.display_name || billedTo?.full_name || 'Family account'}</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}>
        {error ? <TouchableOpacity style={styles.errorCard} onPress={() => load()}><Text style={styles.errorText}>{error} Tap to retry.</Text></TouchableOpacity> : null}
        {invoice ? (
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryTop}><View><Text style={styles.eyebrow}>AMOUNT DUE</Text><Text style={styles.total}>{money(balanceCents)}</Text></View><View style={[styles.status, overdue ? styles.statusDanger : invoice.status === 'paid' ? styles.statusPaid : styles.statusOpen]}><Text style={[styles.statusText, overdue ? styles.statusTextDanger : invoice.status === 'paid' ? styles.statusTextPaid : styles.statusTextOpen]}>{overdue ? 'Overdue' : invoice.status === 'paid' ? 'Paid' : 'Open'}</Text></View></View>
              <Text style={styles.summaryMeta}>{money(invoice.total_cents)} total · due {dateLabel(invoice.due_on)}</Text>
              {payable && balanceCents > 0 ? <TouchableOpacity style={styles.recordButton} onPress={() => setPaymentOpen(true)}><Ionicons name="cash-outline" size={18} color={colors.white} /><Text style={styles.recordButtonText}>Record payment</Text></TouchableOpacity> : null}
            </View>

            <Text style={styles.sectionTitle}>Invoice details</Text>
            <View style={styles.card}>
              <DetailRow label="Family" value={family?.display_name || billedTo?.full_name} />
              <DetailRow label="Child" value={child ? `${child.first_name} ${child.last_name}` : null} />
              <DetailRow label="Issued" value={dateLabel(invoice.issued_on)} />
              <DetailRow label="Due" value={dateLabel(invoice.due_on)} last />
            </View>

            <Text style={styles.sectionTitle}>Charges</Text>
            <View style={styles.card}>
              {(invoice.lines || []).map((line, index) => <DetailRow key={line.id} label={`${line.quantity || 1} × ${line.description}`} value={money(line.amount_cents)} last={index === invoice.lines.length - 1} />)}
              {!invoice.lines?.length ? <Text style={styles.emptyText}>No line-item detail is available.</Text> : null}
            </View>

            <Text style={styles.sectionTitle}>Payment history</Text>
            <View style={styles.card}>
              {payments.map((payment, index) => <DetailRow key={payment.id} label={`${dateLabel(payment.paid_at, true)} · ${payment.method || 'Payment'}`} value={money(payment.amount_cents)} last={index === payments.length - 1} />)}
              {!payments.length ? <Text style={styles.emptyText}>No payments have been recorded.</Text> : null}
            </View>

            <Text style={styles.sectionTitle}>Reminder history</Text>
            <View style={styles.card}>
              {(invoice.reminders || []).map((reminder, index) => <DetailRow key={reminder.id} label={`${dateLabel(reminder.sent_at, true)} · ${reminder.tone || 'friendly'}`} value={reminder.status || 'queued'} last={index === invoice.reminders.length - 1} />)}
              {!invoice.reminders?.length ? <Text style={styles.emptyText}>No reminders have been sent.</Text> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
      <PaymentModal visible={paymentOpen} balanceCents={balanceCents} busy={busy} onClose={() => setPaymentOpen(false)} onSubmit={recordPayment} />
    </SafeAreaView>
  );
}

function DetailRow({ label, value, last }) {
  return <View style={[styles.detailRow, !last && styles.detailBorder]}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value || '—'}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }, flex: { flex: 1, minWidth: 0 },
  header: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface }, back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 20 },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 }, subtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 }, content: { padding: spacing.xl, paddingBottom: 44 },
  summaryCard: { padding: spacing.lg, marginBottom: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.primaryLight }, summaryTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, eyebrow: { color: colors.primary, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8 }, total: { marginTop: 4, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 27 }, summaryMeta: { marginTop: spacing.xs, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  status: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full }, statusDanger: { backgroundColor: colors.dangerLight }, statusPaid: { backgroundColor: colors.successLight }, statusOpen: { backgroundColor: colors.surface }, statusText: { fontFamily: fonts.bold, fontSize: 10.5 }, statusTextDanger: { color: colors.danger }, statusTextPaid: { color: colors.success }, statusTextOpen: { color: colors.primary },
  recordButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary }, recordButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13.5 },
  sectionTitle: { marginBottom: spacing.sm, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 }, card: { overflow: 'hidden', marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface }, detailRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md }, detailBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft }, detailLabel: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 }, detailValue: { maxWidth: '54%', color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 11.5, textAlign: 'right' }, emptyText: { padding: spacing.lg, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  errorCard: { padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight }, errorText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,0.35)' }, modalCard: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface }, modalHandle: { alignSelf: 'center', width: 42, height: 5, marginBottom: spacing.lg, borderRadius: 3, backgroundColor: colors.border }, modalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl }, modalTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 }, modalSubtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 }, modalClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 19 },
  fieldLabel: { marginBottom: spacing.sm, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 }, amountInput: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.xs, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }, inputError: { borderColor: colors.danger }, currency: { marginRight: spacing.xs, color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 16 }, amountField: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 16 }, fieldError: { marginBottom: spacing.md, color: colors.danger, fontFamily: fonts.bold, fontSize: 11 },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl }, methodButton: { paddingHorizontal: spacing.md, paddingVertical: 9, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }, methodButtonActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, methodText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 11.5 }, methodTextActive: { color: colors.primary },
  modalActions: { flexDirection: 'row', gap: spacing.sm }, secondaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, secondaryText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 13 }, primaryButton: { flex: 1.4, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary }, primaryText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 }, disabledButton: { opacity: 0.55 },
});
