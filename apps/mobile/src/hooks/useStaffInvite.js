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
import { extractStaffInviteCode, handleAuthUrl } from '../lib/authLinks';

const StaffInviteContext = createContext(null);
const PENDING_INVITE_KEY = 'dailylog_pending_staff_invite';

export function StaffInviteProvider({ children }) {
  const [code, setCode] = useState(null);
  const [accepted, setAccepted] = useState(null);
  const [hydrating, setHydrating] = useState(true);
  const [suspended, setSuspended] = useState(false);

  const beginInvite = useCallback(async (nextCode) => {
    const normalized = nextCode?.trim();
    if (!normalized) return;

    setAccepted(null);
    setSuspended(false);
    setCode(normalized);
    await AsyncStorage.setItem(PENDING_INVITE_KEY, normalized);
  }, []);

  const handleIncomingUrl = useCallback(async (url) => {
    const inviteCode = extractStaffInviteCode(url);
    if (inviteCode) await beginInvite(inviteCode);
    await handleAuthUrl(url);
  }, [beginInvite]);

  useEffect(() => {
    let active = true;

    (async () => {
      const [storedCode, initialUrl] = await Promise.all([
        AsyncStorage.getItem(PENDING_INVITE_KEY),
        Linking.getInitialURL(),
      ]);
      if (!active) return;

      if (storedCode) setCode(storedCode);
      if (initialUrl) await handleIncomingUrl(initialUrl);
      if (active) setHydrating(false);
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [handleIncomingUrl]);

  const markAccepted = useCallback(async (summary) => {
    // The invite is single-use after this point. Keep the success summary in
    // memory for 21d, but do not restore a consumed code after an app restart.
    await AsyncStorage.removeItem(PENDING_INVITE_KEY);
    setCode(null);
    setAccepted(summary);
    setSuspended(false);
  }, []);

  const finishInvite = useCallback(async () => {
    await AsyncStorage.removeItem(PENDING_INVITE_KEY);
    setCode(null);
    setAccepted(null);
    setSuspended(false);
  }, []);

  const value = useMemo(() => ({
    code,
    accepted,
    hydrating,
    suspended,
    beginInvite,
    markAccepted,
    finishInvite,
    suspendInvite: () => setSuspended(true),
    resumeInvite: () => setSuspended(false),
  }), [
    accepted,
    beginInvite,
    code,
    finishInvite,
    hydrating,
    markAccepted,
    suspended,
  ]);

  return (
    <StaffInviteContext.Provider value={value}>
      {children}
    </StaffInviteContext.Provider>
  );
}

export function useStaffInvite() {
  const context = useContext(StaffInviteContext);
  if (!context) {
    throw new Error('useStaffInvite must be used inside StaffInviteProvider');
  }
  return context;
}
