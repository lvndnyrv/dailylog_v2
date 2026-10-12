import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';

function messageFor(error, fallback) {
  return error?.message || fallback;
}

export function useParentBilling() {
  const [home, setHome] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_parent_billing_home');
    setLoading(false);
    if (loadError) {
      const message = messageFor(loadError, 'Billing could not be loaded.');
      setError(message);
      throw new Error(message);
    }
    setHome(data);
    return data;
  }, []);

  const getInvoice = useCallback(async (invoiceId) => {
    const [invoiceResult, historyResult] = await Promise.all([
      supabase.rpc('get_parent_billing_invoice', { p_invoice_id: invoiceId }),
      supabase.rpc('get_parent_invoice_payment_history', { p_invoice_id: invoiceId }),
    ]);
    if (invoiceResult.error) {
      throw new Error(messageFor(invoiceResult.error, 'The invoice could not be loaded.'));
    }
    if (historyResult.error) {
      throw new Error(messageFor(historyResult.error, 'Payment history could not be loaded.'));
    }
    return { ...invoiceResult.data, payment_history: historyResult.data || [] };
  }, []);

  const setPreferences = useCallback(async (autopayEnabled, paymentMethodId) => {
    const { data, error: saveError } = await supabase.rpc('set_parent_billing_preferences', {
      p_autopay_enabled: autopayEnabled,
      p_payment_method_id: paymentMethodId || null,
    });
    if (saveError) throw new Error(messageFor(saveError, 'Billing preferences could not be saved.'));
    setHome((current) => (current ? { ...current, preferences: data } : current));
    return data;
  }, []);

  const completeDemoPayment = useCallback(async (invoiceId, paymentMethodId) => {
    const { data, error: paymentError } = await supabase.rpc('complete_demo_parent_invoice_payment', {
      p_invoice_id: invoiceId,
      p_payment_method_id: paymentMethodId,
    });
    if (paymentError) throw new Error(messageFor(paymentError, 'The payment could not be completed.'));
    return data;
  }, []);

  const addDemoPaymentMethod = useCallback(async ({
    methodType, brand, last4, expiryMonth, expiryYear, makeDefault,
  }) => {
    const { data, error: addError } = await supabase.rpc('add_demo_parent_payment_method', {
      p_method_type: methodType,
      p_brand: brand,
      p_last4: last4,
      p_expiry_month: expiryMonth || null,
      p_expiry_year: expiryYear || null,
      p_make_default: Boolean(makeDefault),
    });
    if (addError) throw new Error(messageFor(addError, 'The payment method could not be added.'));
    return data;
  }, []);

  const removePaymentMethod = useCallback(async (paymentMethodId) => {
    const { data, error: removeError } = await supabase.rpc('remove_parent_payment_method', {
      p_payment_method_id: paymentMethodId,
    });
    if (removeError) throw new Error(messageFor(removeError, 'The payment method could not be removed.'));
    setHome(data);
    return data;
  }, []);

  const getPaymentReceipt = useCallback(async (paymentId) => {
    const { data, error: receiptError } = await supabase.rpc('get_parent_payment_receipt', {
      p_payment_id: paymentId,
    });
    if (receiptError) throw new Error(messageFor(receiptError, 'The receipt could not be loaded.'));
    return data;
  }, []);

  const resendPaymentReceipt = useCallback(async (paymentId) => {
    const { data, error: resendError } = await supabase.rpc('resend_parent_payment_receipt', {
      p_payment_id: paymentId,
    });
    if (resendError) throw new Error(messageFor(resendError, 'The receipt email could not be queued.'));
    return data;
  }, []);

  return {
    home,
    loading,
    error,
    refresh,
    getInvoice,
    setPreferences,
    completeDemoPayment,
    addDemoPaymentMethod,
    removePaymentMethod,
    getPaymentReceipt,
    resendPaymentReceipt,
  };
}
