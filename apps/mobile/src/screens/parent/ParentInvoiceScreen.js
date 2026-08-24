import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '../../components/ui';
import { useParentBilling } from '../../hooks/useParentBilling';
import { colors, fonts, radius, spacing } from '../../theme';
import { isPaymentMethodExpired, money, monthLabel, PaymentMethodRow, ScreenHeader, sharedStyles, shortDate } from './ParentBillingShared';

export default function ParentInvoiceScreen({ navigation, route }) {
  const invoiceId = route.params?.invoiceId;
  const { getInvoice, completeDemoPayment } = useParentBilling();
  const [invoice, setInvoice] = useState(null);
  const [selectedMethodId, setSelectedMethodId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [paymentError, setPaymentError] = useState('');

  const load = useCallback(async () => {
    if (!invoiceId) {
      setError('This invoice is unavailable.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getInvoice(invoiceId);
      setInvoice(data);
      const usableMethods = (data.payment_methods || []).filter((method) => !isPaymentMethodExpired(method));
      const preferred = usableMethods.find((method) => method.id === data.default_payment_method_id)?.id;
      setSelectedMethodId((current) => usableMethods.some((method) => method.id === current)
        ? current
        : preferred || usableMethods[0]?.id || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [getInvoice, invoiceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (invoice && !invoice.payment_methods?.some((method) => method.id === selectedMethodId && !isPaymentMethodExpired(method))) {
      const usableMethods = (invoice.payment_methods || []).filter((method) => !isPaymentMethodExpired(method));
      const preferred = usableMethods.find((method) => method.id === invoice.default_payment_method_id)?.id;
      setSelectedMethodId(preferred || usableMethods[0]?.id || null);
    }
  }, [invoice, selectedMethodId]);

  const selectedMethod = invoice?.payment_methods?.find((method) => method.id === selectedMethodId);
  const paid = invoice?.balance_cents === 0;
  const refundedPayment = invoice?.payment_history?.find((payment) => payment.status === 'refunded');
  const failedAttempt = invoice?.payment_history?.find((payment) => payment.status === 'failed');
  const settledPayment = invoice?.payment_history?.find((payment) => payment.status === 'succeeded');

  function beginPayment() {
    setPaymentError('');
    if (!selectedMethod) {
      Alert.alert('Choose a payment method', 'Select a payment method before continuing.');
      return;
    }
    if (selectedMethod.provider !== 'demo') {
      Alert.alert('Online payments unavailable', 'This payment method needs a configured payment provider. No charge was attempted.');
      return;
    }
    Alert.alert(
      'Complete test payment?',
      `This development payment will mark the invoice paid. No real ${selectedMethod.brand || 'payment method'} will be charged.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Test pay ${money(invoice.balance_cents, invoice.currency)}`, onPress: pay },
      ],
    );
  }

  async function pay() {
    setPaying(true);
    setPaymentError('');
    try {
      const receipt = await completeDemoPayment(invoice.id, selectedMethod.id);
      if (receipt?.status === 'failed') {
        setPaymentError(receipt.failure_message || 'The payment was declined. Choose another method and try again.');
        await load();
        return;
      }
      navigation.navigate('PaymentReceipt', { paymentId: receipt.payment_id, receipt });
    } catch (paymentFailure) {
      setPaymentError(paymentFailure.message || 'The payment could not be completed.');
    } finally {
      setPaying(false);
    }
  }

  function viewReceipt() {
    const payment = invoice.payment_history?.find((item) => ['succeeded', 'refunded'].includes(item.status))
      || invoice.payments?.[0];
    const method = payment?.payment_method
      || invoice.payment_methods?.find((item) => item.id === payment?.payment_method_id);
    if (!payment) return;
    navigation.navigate('PaymentReceipt', {
      paymentId: payment.id,
      receipt: {
        payment_id: payment.id,
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        invoice_label: monthLabel(invoice.issued_on),
        amount_cents: payment.amount_cents,
        currency: invoice.currency,
        paid_at: payment.paid_at,
        receipt_number: payment.receipt_number,
        receipt_email: payment.receipt_emailed_to,
        payment_method: method || { brand: payment.method, last4: '' },
        status: payment.status || 'succeeded',
        refunded_at: payment.refunded_at,
        refund_reason: payment.refund_reason,
      },
    });
  }

  return (
    <SafeAreaView style={sharedStyles.safeArea} edges={['top']}>
      <ScreenHeader navigation={navigation} title={invoice ? monthLabel(invoice.issued_on) : 'Invoice'} subtitle={invoice?.number} />
      {loading && !invoice ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View> : null}
      {error && !invoice ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={30} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : null}
      {invoice ? (
        <>
          <ScrollView contentContainerStyle={sharedStyles.content}>
            <View style={styles.summaryRow}>
              <View>
                <Text style={styles.summaryLabel}>{paid ? 'Paid in full' : `Due ${shortDate(invoice.due_on)}`}</Text>
                <Text style={styles.summaryAmount}>{money(paid ? invoice.total_cents : invoice.balance_cents, invoice.currency)}</Text>
              </View>
              <View style={[styles.statusPill, paid ? styles.paidPill : styles.duePill]}>
                <Text style={[styles.statusText, paid ? styles.paidText : styles.dueText]}>{paid ? 'Paid' : invoice.status === 'overdue' ? 'Overdue' : 'Due'}</Text>
              </View>
            </View>

            <View style={styles.linesCard}>
              {(invoice.lines || []).map((line, index) => (
                <View key={line.id} style={[styles.lineRow, index > 0 && styles.lineBorder]}>
                  <Text style={[styles.lineLabel, line.amount_cents < 0 && styles.discount]}>{line.description}</Text>
                  <Text style={[styles.lineAmount, line.amount_cents < 0 && styles.discount]}>{money(line.amount_cents, invoice.currency)}</Text>
                </View>
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalText}>{paid ? 'Invoice total' : 'Total due'}</Text>
                <Text style={styles.totalText}>{money(paid ? invoice.total_cents : invoice.balance_cents, invoice.currency)}</Text>
              </View>
            </View>

            {paid ? (
              <View style={styles.paidCard}>
                <Ionicons name="checkmark-circle" size={25} color={colors.success} />
                <View style={styles.paidCopy}>
                  <Text style={styles.paidTitle}>Payment received</Text>
                  <Text style={styles.paidSubtitle}>{settledPayment?.receipt_number || invoice.payments?.[0]?.receipt_number || 'Receipt available'}</Text>
                </View>
                {settledPayment || invoice.payments?.length ? <TouchableOpacity onPress={viewReceipt}><Text style={styles.viewReceipt}>View receipt</Text></TouchableOpacity> : null}
              </View>
            ) : (
              <>
                {refundedPayment ? (
                  <View style={styles.refundCard}>
                    <Ionicons name="return-down-back-outline" size={22} color={colors.amber} />
                    <View style={styles.refundCopy}>
                      <Text style={styles.refundTitle}>Previous payment refunded</Text>
                      <Text style={styles.refundText}>{refundedPayment.refund_reason || 'The amount is due again unless your center applies a credit.'}</Text>
                    </View>
                    <TouchableOpacity onPress={viewReceipt}><Text style={styles.refundLink}>Receipt</Text></TouchableOpacity>
                  </View>
                ) : null}
                {paymentError || failedAttempt ? (
                  <View style={styles.paymentErrorCard} accessibilityRole="alert">
                    <Ionicons name="alert-circle" size={22} color={colors.danger} />
                    <View style={styles.paymentErrorCopy}>
                      <Text style={styles.paymentErrorTitle}>Payment not completed</Text>
                      <Text style={styles.paymentErrorText}>
                        {paymentError || 'The previous attempt was declined. Choose another payment method and try again.'}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <Text style={styles.sectionTitle}>Pay with</Text>
                <View style={styles.methodList}>
                  {(invoice.payment_methods || []).map((method) => (
                    <PaymentMethodRow
                      key={method.id}
                      method={method}
                      selected={selectedMethodId === method.id}
                      onPress={() => {
                        setSelectedMethodId(method.id);
                        setPaymentError('');
                      }}
                    />
                  ))}
                  <TouchableOpacity style={styles.addMethod} onPress={() => navigation.navigate('ParentPaymentMethods')}>
                    <View style={styles.addIcon}><Ionicons name="add" size={20} color={colors.textFaint} /></View>
                    <Text style={styles.addMethodText}>Add payment method</Text>
                  </TouchableOpacity>
                </View>
                {selectedMethod?.provider === 'demo' ? (
                  <View style={styles.demoNotice}>
                    <Ionicons name="flask-outline" size={18} color={colors.amber} />
                    <Text style={styles.demoText}>Test payment method · no real card or bank account will be charged.</Text>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
          {!paid ? (
            <View style={styles.footer}>
              <Button
                label={selectedMethod?.provider === 'demo' ? `Test pay ${money(invoice.balance_cents, invoice.currency)}` : `Pay ${money(invoice.balance_cents, invoice.currency)}`}
                onPress={beginPayment}
                loading={paying}
                disabled={!selectedMethod}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorText: { color: colors.danger, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: spacing.md },
  retryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14, marginTop: spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: spacing.sm },
  summaryLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  summaryAmount: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 28, marginTop: 3 },
  statusPill: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  paidPill: { backgroundColor: colors.successLight },
  duePill: { backgroundColor: colors.amberLight },
  statusText: { fontFamily: fonts.bold, fontSize: 12 },
  paidText: { color: colors.success },
  dueText: { color: colors.amber },
  linesCard: { ...sharedStyles.card, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  lineRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  lineBorder: { borderTopWidth: 1, borderTopColor: colors.primarySoft },
  lineLabel: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14 },
  lineAmount: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  discount: { color: colors.success },
  totalRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1.5, borderTopColor: colors.primarySoft },
  totalText: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, marginTop: spacing.lg, marginBottom: spacing.md },
  methodList: { gap: spacing.sm },
  addMethod: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg },
  addIcon: { width: 42, height: 28, borderRadius: radius.sm, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  addMethodText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 14 },
  demoNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.amberLight, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  demoText: { flex: 1, color: colors.amber, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  footer: { paddingHorizontal: 22, paddingTop: spacing.md, paddingBottom: 26, borderTopWidth: 1, borderTopColor: colors.primaryLight, backgroundColor: colors.bg },
  paidCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.successLight },
  paidCopy: { flex: 1 },
  paidTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14.5 },
  paidSubtitle: { color: colors.success, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  viewReceipt: { color: colors.success, fontFamily: fonts.bold, fontSize: 12.5 },
  refundCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.amberLight },
  refundCopy: { flex: 1, minWidth: 0 },
  refundTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  refundText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 3 },
  refundLink: { color: colors.amber, fontFamily: fonts.bold, fontSize: 12.5, paddingTop: 2 },
  paymentErrorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: 'rgba(194,65,65,0.18)' },
  paymentErrorCopy: { flex: 1, minWidth: 0 },
  paymentErrorTitle: { color: colors.danger, fontFamily: fonts.bold, fontSize: 14 },
  paymentErrorText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
});
