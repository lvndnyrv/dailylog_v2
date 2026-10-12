import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { extractPaymentReceiptId } from '../lib/authLinks';

const PaymentReceiptLinkContext = createContext(null);
const PENDING_RECEIPT_KEY = 'dailylog_pending_payment_receipt';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function PaymentReceiptLinkProvider({ children }) {
  const [paymentId, setPaymentId] = useState(null);
  const [hydrating, setHydrating] = useState(true);

  const beginReceipt = useCallback(async (nextPaymentId) => {
    const normalized = nextPaymentId?.trim().toLowerCase();
    if (!normalized || !UUID.test(normalized)) return false;
    setPaymentId(normalized);
    await AsyncStorage.setItem(PENDING_RECEIPT_KEY, normalized);
    return true;
  }, []);

  const finishReceipt = useCallback(async () => {
    await AsyncStorage.removeItem(PENDING_RECEIPT_KEY);
    setPaymentId(null);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const [storedId, initialUrl] = await Promise.all([
        AsyncStorage.getItem(PENDING_RECEIPT_KEY),
        Linking.getInitialURL(),
      ]);
      if (!active) return;
      const linkedId = extractPaymentReceiptId(initialUrl);
      if (linkedId) await beginReceipt(linkedId);
      else if (storedId && UUID.test(storedId)) setPaymentId(storedId);
      if (active) setHydrating(false);
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const linkedId = extractPaymentReceiptId(url);
      if (linkedId) beginReceipt(linkedId);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [beginReceipt]);

  const value = useMemo(() => ({
    paymentId,
    hydrating,
    beginReceipt,
    finishReceipt,
  }), [beginReceipt, finishReceipt, hydrating, paymentId]);

  return (
    <PaymentReceiptLinkContext.Provider value={value}>
      {children}
    </PaymentReceiptLinkContext.Provider>
  );
}

export function usePaymentReceiptLink() {
  const context = useContext(PaymentReceiptLinkContext);
  if (!context) throw new Error('usePaymentReceiptLink must be used inside PaymentReceiptLinkProvider');
  return context;
}
