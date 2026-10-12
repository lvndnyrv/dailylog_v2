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
import { extractEnrollmentOfferCode } from '../lib/authLinks';

const EnrollmentOfferContext = createContext(null);
const PENDING_OFFER_KEY = 'dailylog_pending_enrollment_offer';

export function EnrollmentOfferProvider({ children }) {
  const [code, setCode] = useState(null);
  const [revision, setRevision] = useState(0);
  const [hydrating, setHydrating] = useState(true);

  const beginOffer = useCallback(async (nextCode) => {
    const normalized = nextCode?.trim().toUpperCase();
    if (!normalized) return;
    setCode(normalized);
    // Opening the same secure link again should refresh its server state. This
    // avoids changing to a dummy code just to revalidate an in-progress offer.
    setRevision((value) => value + 1);
    await AsyncStorage.setItem(PENDING_OFFER_KEY, normalized);
  }, []);

  const finishOffer = useCallback(async () => {
    await AsyncStorage.removeItem(PENDING_OFFER_KEY);
    setCode(null);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const [storedCode, initialUrl] = await Promise.all([
        AsyncStorage.getItem(PENDING_OFFER_KEY),
        Linking.getInitialURL(),
      ]);
      if (!active) return;
      const linkedCode = extractEnrollmentOfferCode(initialUrl);
      if (linkedCode) await beginOffer(linkedCode);
      else if (storedCode) setCode(storedCode);
      if (active) setHydrating(false);
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const linkedCode = extractEnrollmentOfferCode(url);
      if (linkedCode) beginOffer(linkedCode);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [beginOffer]);

  const value = useMemo(() => ({
    code,
    revision,
    hydrating,
    beginOffer,
    finishOffer,
  }), [beginOffer, code, finishOffer, hydrating, revision]);

  return (
    <EnrollmentOfferContext.Provider value={value}>
      {children}
    </EnrollmentOfferContext.Provider>
  );
}

export function useEnrollmentOffer() {
  const context = useContext(EnrollmentOfferContext);
  if (!context) throw new Error('useEnrollmentOffer must be used inside EnrollmentOfferProvider');
  return context;
}
