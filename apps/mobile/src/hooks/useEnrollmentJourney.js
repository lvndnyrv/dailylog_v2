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

import { extractEnrollmentJourney } from '../lib/authLinks';

const EnrollmentJourneyContext = createContext(null);
const JOURNEY_CODE_KEY = 'dailylog_pending_enrollment_journey';
const JOURNEY_CENTER_KEY = 'dailylog_pending_inquiry_center';

export function EnrollmentJourneyProvider({ children }) {
  const [code, setCode] = useState(null);
  const [centerId, setCenterId] = useState(null);
  const [hydrating, setHydrating] = useState(true);

  const beginJourney = useCallback(async (nextCode) => {
    const normalized = nextCode?.trim().toUpperCase();
    if (!normalized) return;
    setCode(normalized);
    setCenterId(null);
    await AsyncStorage.multiSet([[JOURNEY_CODE_KEY, normalized]]);
    await AsyncStorage.removeItem(JOURNEY_CENTER_KEY);
  }, []);

  const beginInquiry = useCallback(async (nextCenterId) => {
    const normalized = nextCenterId?.trim();
    if (!normalized) return;
    setCenterId(normalized);
    setCode(null);
    await AsyncStorage.multiSet([[JOURNEY_CENTER_KEY, normalized]]);
    await AsyncStorage.removeItem(JOURNEY_CODE_KEY);
  }, []);

  const finishJourney = useCallback(async () => {
    await AsyncStorage.multiRemove([JOURNEY_CODE_KEY, JOURNEY_CENTER_KEY]);
    setCode(null);
    setCenterId(null);
  }, []);

  const acceptLink = useCallback(async (url) => {
    const journey = extractEnrollmentJourney(url);
    if (journey?.code) await beginJourney(journey.code);
    else if (journey?.centerId) await beginInquiry(journey.centerId);
  }, [beginInquiry, beginJourney]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [storedCode, storedCenter, initialUrl] = await Promise.all([
        AsyncStorage.getItem(JOURNEY_CODE_KEY),
        AsyncStorage.getItem(JOURNEY_CENTER_KEY),
        Linking.getInitialURL(),
      ]);
      if (!active) return;
      const linked = extractEnrollmentJourney(initialUrl);
      if (linked?.code) await beginJourney(linked.code);
      else if (linked?.centerId) await beginInquiry(linked.centerId);
      else if (storedCode) setCode(storedCode);
      else if (storedCenter) setCenterId(storedCenter);
      if (active) setHydrating(false);
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      acceptLink(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [acceptLink, beginInquiry, beginJourney]);

  const value = useMemo(() => ({
    code,
    centerId,
    hydrating,
    beginJourney,
    beginInquiry,
    finishJourney,
  }), [beginInquiry, beginJourney, centerId, code, finishJourney, hydrating]);

  return (
    <EnrollmentJourneyContext.Provider value={value}>
      {children}
    </EnrollmentJourneyContext.Provider>
  );
}

export function useEnrollmentJourney() {
  const context = useContext(EnrollmentJourneyContext);
  if (!context) throw new Error('useEnrollmentJourney must be used inside EnrollmentJourneyProvider');
  return context;
}
