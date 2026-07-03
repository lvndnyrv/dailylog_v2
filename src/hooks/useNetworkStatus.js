import { useState, useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { flushQueue, getQueueLength } from '../lib/offlineQueue';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const wasOffline = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async state => {
      const online = state.isConnected && state.isInternetReachable;
      setIsOnline(online);

      if (online && wasOffline.current) {
        // Just came back online — flush the queue
        console.log('Back online — flushing offline queue');
        await flushQueue();
        const remaining = await getQueueLength();
        setPendingCount(remaining);
        wasOffline.current = false;
      } else if (!online) {
        wasOffline.current = true;
        const count = await getQueueLength();
        setPendingCount(count);
      }
    });

    return () => unsubscribe();
  }, []);

  return { isOnline, pendingCount };
}
