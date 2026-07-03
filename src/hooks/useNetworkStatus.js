import { useState, useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { flushQueue, getQueueLength, subscribeQueue } from '../lib/offlineQueue';
import { showToast } from '../components/Toast';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const wasOffline = useRef(false);

  useEffect(() => {
    // Initial pending count + flush anything left over from a previous session
    getQueueLength().then(async count => {
      setPendingCount(count);
      if (count > 0) {
        const { flushed } = await flushQueue();
        if (flushed > 0) showToast(`✓ Synced ${flushed} offline change${flushed === 1 ? '' : 's'}`, 'success');
      }
    });

    // Live queue updates (enqueue/flush/clear from anywhere in the app)
    const unsubQueue = subscribeQueue(setPendingCount);

    const unsubNet = NetInfo.addEventListener(async state => {
      // isInternetReachable is null while undetermined — treat null as online
      const online = !!state.isConnected && state.isInternetReachable !== false;
      setIsOnline(online);

      if (online && wasOffline.current) {
        // Just came back online — flush the queue
        wasOffline.current = false;
        const { flushed, remaining } = await flushQueue();
        if (flushed > 0) showToast(`✓ Synced ${flushed} offline change${flushed === 1 ? '' : 's'}`, 'success');
        if (remaining > 0) showToast(`${remaining} change${remaining === 1 ? '' : 's'} still pending`, 'info');
      } else if (!online) {
        wasOffline.current = true;
      }
    });

    return () => {
      unsubQueue();
      unsubNet();
    };
  }, []);

  return { isOnline, pendingCount };
}
