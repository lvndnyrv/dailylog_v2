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
import { extractParentChildInviteCode, handleAuthUrl } from '../lib/authLinks';

const ParentChildInviteContext = createContext(null);
const PENDING_CHILD_INVITE_KEY = 'dailylog_pending_parent_child_invite';

export function ParentChildInviteProvider({ children }) {
  const [code, setCode] = useState(null);
  const [hydrating, setHydrating] = useState(true);

  const beginInvite = useCallback(async (nextCode) => {
    const normalized = String(nextCode || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (!normalized) return;
    setCode(normalized);
    await AsyncStorage.setItem(PENDING_CHILD_INVITE_KEY, normalized);
  }, []);

  const finishInvite = useCallback(async () => {
    await AsyncStorage.removeItem(PENDING_CHILD_INVITE_KEY);
    setCode(null);
  }, []);

  const handleIncomingUrl = useCallback(async (url) => {
    const linkedCode = extractParentChildInviteCode(url);
    if (linkedCode) await beginInvite(linkedCode);
    await handleAuthUrl(url);
  }, [beginInvite]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [storedCode, initialUrl] = await Promise.all([
        AsyncStorage.getItem(PENDING_CHILD_INVITE_KEY),
        Linking.getInitialURL(),
      ]);
      if (!active) return;
      const linkedCode = extractParentChildInviteCode(initialUrl);
      if (linkedCode) await beginInvite(linkedCode);
      else if (storedCode) setCode(storedCode);
      if (active) setHydrating(false);
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [beginInvite, handleIncomingUrl]);

  const value = useMemo(() => ({
    code,
    hydrating,
    beginInvite,
    finishInvite,
  }), [beginInvite, code, finishInvite, hydrating]);

  return (
    <ParentChildInviteContext.Provider value={value}>
      {children}
    </ParentChildInviteContext.Provider>
  );
}

export function useParentChildInvite() {
  const context = useContext(ParentChildInviteContext);
  if (!context) throw new Error('useParentChildInvite must be used inside ParentChildInviteProvider');
  return context;
}
