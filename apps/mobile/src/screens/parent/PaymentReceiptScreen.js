import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '../../components/ui';
import { useParentBilling } from '../../hooks/useParentBilling';
import { usePaymentReceiptLink } from '../../hooks/usePaymentReceiptLink';
import { navigate as navigateRoot } from '../../lib/navigationRef';
import { exportPaymentReceiptPdf } from '../../lib/export';
import { colors, fonts, spacing } from '../../theme';
import { money, sharedStyles } from './ParentBillingShared';

function paidAt(value) {
  if (!value) return 'Just now';
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

function ReceiptRow({ label, value, last, mono }) {
  return (
    <View style={[styles.receiptRow, !last && styles.receiptBorder]}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={[styles.receiptValue, mono && styles.receiptMono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function deliveryCopy(receipt) {
  if (!receipt?.receipt_email) return null;
  if (receipt.email_status === 'delivered') {
    return { icon: 'mail-outline', text: `Emailed to ${receipt.receipt_email}`, danger: false };
  }
  if (['pending', 'processing'].includes(receipt.email_status)) {
    return { icon: 'mail-unread-outline', text: `Receipt is on its way to ${receipt.receipt_email}`, danger: false };
  }
  if (receipt.email_status === 'failed') {
    return { icon: 'alert-circle-outline', text: `Receipt saved here · email delivery is delayed for ${receipt.receipt_email}`, danger: true };
  }
  return { icon: 'mail-outline', text: `Receipt saved for ${receipt.receipt_email}`, danger: false };
}

export default function PaymentReceiptScreen({ navigation, route }) {
  const routeReceipt = route.params?.receipt || null;
  const { getPaymentReceipt } = useParentBilling();
  const { paymentId: linkedPaymentId, finishReceipt } = usePaymentReceiptLink();
  const paymentId = linkedPaymentId || route.params?.paymentId || routeReceipt?.payment_id;
  const [receipt, setReceipt] = useState(routeReceipt);
  const [loading, setLoading] = useState(!routeReceipt);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let active = true;
    if (!paymentId) {
      setLoading(false);
      setError('This receipt link is incomplete.');
      return () => { active = false; };
    }

    if (receipt?.payment_id !== paymentId) {
      setReceipt(null);
      setLoading(true);
    }
    setError('');
    getPaymentReceipt(paymentId)
      .then((data) => {
        if (active) setReceipt(data);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [getPaymentReceipt, paymentId, retryKey]);

  const methodLabel = useMemo(() => {
    const method = receipt?.payment_method || {};
    return method.last4
      ? `${method.brand || method.method_type} ···· ${method.last4}`
      : method.brand || 'Payment method';
  }, [receipt?.payment_method]);
  const email = deliveryCopy(receipt);
  const refunded = receipt?.status === 'refunded';
  const receiptStatusCopy = receipt?.receipt_email && receipt.email_status === 'delivered'
    ? 'A receipt was sent to your email.'
    : receipt?.receipt_email && ['pending', 'processing'].includes(receipt.email_status)
      ? 'A receipt is on its way to your email.'
      : 'Your receipt is ready below.';

  async function leaveLinkedReceipt(destination, params) {
    if (linkedPaymentId) {
      await finishReceipt();
      setTimeout(() => navigateRoot(destination, params), 50);
      return;
    }
    if (typeof navigation.popTo === 'function') navigation.popTo(destination, params);
    else navigation.navigate(destination, params);
  }

  async function shareReceipt() {
    setSharing(true);
    try {
      await exportPaymentReceiptPdf({
        receipt,
        daycareName: receipt.daycare_name,
        familyName: receipt.family_name,
      });
    } catch (shareError) {
      Alert.alert('Receipt not shared', shareError.message || 'The receipt PDF could not be created.');
    } finally {
      setSharing(false);
    }
  }

  if (loading && !receipt) {
    return (
      <SafeAreaView style={sharedStyles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Loading your receipt…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!receipt) {
    return (
      <SafeAreaView style={sharedStyles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <View style={styles.errorCircle}><Ionicons name="receipt-outline" size={34} color={colors.danger} /></View>
          <Text style={styles.stateTitle}>Receipt unavailable</Text>
          <Text style={styles.stateText}>{error || 'This receipt could not be loaded.'}</Text>
          {paymentId ? <Button label="Try again" onPress={() => setRetryKey((value) => value + 1)} style={styles.stateButton} /> : null}
          <TouchableOpacity onPress={() => leaveLinkedReceipt('BillingHome')} style={styles.returnButton}>
            <Text style={styles.returnText}>Return to billing</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={sharedStyles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.checkCircle, refunded && styles.refundCircle]}>
          <Ionicons name={refunded ? 'return-down-back' : 'checkmark'} size={refunded ? 34 : 40} color={refunded ? colors.amber : colors.success} />
        </View>
        <Text style={styles.title}>{refunded ? 'Payment refunded' : 'Payment received'}</Text>
        <Text style={styles.subtitle}>
          {refunded
            ? `The payment for your ${receipt.invoice_label || 'invoice'} was returned. ${receipt.refund_reason || 'Your billing balance has been updated.'}`
            : `Thanks! Your ${receipt.invoice_label || 'invoice'} is paid in full. ${receiptStatusCopy}`}
        </Text>

        <View style={styles.receiptCard}>
          <ReceiptRow label={refunded ? 'Amount refunded' : 'Amount'} value={money(receipt.amount_cents, receipt.currency)} />
          <ReceiptRow label="Paid with" value={methodLabel} />
          <ReceiptRow label="Paid on" value={paidAt(receipt.paid_at)} />
          {refunded ? <ReceiptRow label="Refunded on" value={paidAt(receipt.refunded_at)} /> : null}
          <ReceiptRow label="Confirmation" value={receipt.receipt_number || 'Recorded'} mono last />
        </View>

        {email ? (
          <View style={[styles.emailRow, email.danger && styles.emailRowDanger]}>
            <Ionicons name={email.icon} size={15} color={email.danger ? colors.danger : colors.textFaint} />
            <Text style={[styles.emailText, email.danger && styles.emailTextDanger]}>{email.text}</Text>
          </View>
        ) : null}

        <View style={styles.spacer} />
        <Button label={sharing ? 'Preparing receipt…' : 'Share receipt'} onPress={shareReceipt} loading={sharing} variant="ghost" style={styles.shareButton} />
        <Button label="Done" onPress={() => leaveLinkedReceipt('BillingHome')} style={styles.doneButton} />
        <TouchableOpacity
          style={styles.viewInvoiceButton}
          onPress={() => leaveLinkedReceipt('ParentInvoice', { invoiceId: receipt.invoice_id })}
          disabled={!receipt.invoice_id}
        >
          <Text style={styles.viewInvoiceText}>View invoice</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 34, paddingBottom: 26 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  stateTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 22, marginTop: spacing.lg },
  stateText: { maxWidth: 310, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: spacing.sm },
  stateButton: { alignSelf: 'stretch', marginTop: spacing.xl },
  errorCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center' },
  returnButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  returnText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 14 },
  checkCircle: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  refundCircle: { backgroundColor: colors.amberLight },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 24, marginTop: spacing.lg },
  subtitle: { maxWidth: 330, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: spacing.sm },
  receiptCard: { width: '100%', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 6, marginTop: spacing.xl },
  receiptRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  receiptBorder: { borderBottomWidth: 1, borderBottomColor: colors.primarySoft },
  receiptLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  receiptValue: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13, textAlign: 'right' },
  receiptMono: { fontFamily: 'Menlo', fontSize: 12 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  emailRowDanger: { maxWidth: '100%', backgroundColor: colors.dangerLight, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  emailText: { flexShrink: 1, color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
  emailTextDanger: { color: colors.danger },
  spacer: { flex: 1, minHeight: spacing.xxl },
  shareButton: { width: '100%', marginBottom: spacing.md },
  doneButton: { width: '100%' },
  viewInvoiceButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  viewInvoiceText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 14 },
});
