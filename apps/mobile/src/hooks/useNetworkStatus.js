import { useState, useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import {
  discardFailedOperations,
  flushQueue,
  getQueueStatus,
  retryFailedOperations,
  subscribeQueue,
} from '../lib/offlineQueue';
import { showToast } from '../components/Toast';

export function useNetworkStatus(ownerId) {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const wasOffline = useRef(false);

  const syncPending = async () => {
    setSyncing(true);
    try {
      const { flushed, remaining, failed } = await flushQueue(ownerId);
      if (flushed > 0) {
        showToast(`Synced ${flushed} offline change${flushed === 1 ? '' : 's'}`, 'success');
      }
      if (failed > 0) {
        showToast(`${failed} offline change${failed === 1 ? '' : 's'} need attention`, 'error');
      } else if (remaining > 0 && isOnline) {
        showToast(`${remaining} change${remaining === 1 ? '' : 's'} still pending`, 'info');
      }
      return { flushed, remaining, failed };
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    // Initial pending count + flush anything left over from a previous session
    if (!ownerId) {
      setPendingCount(0);
      setFailedCount(0);
      return undefined;
    }

    getQueueStatus(ownerId).then(async status => {
      setPendingCount(status.pendingCount);
      setFailedCount(status.failedCount);
      if (status.pendingCount > 0) {
        await syncPending();
      }
    });

    // Live queue updates (enqueue/flush/clear from anywhere in the app)
    const unsubQueue = subscribeQueue(ownerId, (pending, failed) => {
      setPendingCount(pending);
      setFailedCount(failed);
    });

    const unsubNet = NetInfo.addEventListener(async state => {
      // isInternetReachable is null while undetermined — treat null as online
      const online = !!state.isConnected && state.isInternetReachable !== false;
      setIsOnline(online);

      if (online && wasOffline.current) {
        // Just came back online — flush the queue
        wasOffline.current = false;
        await syncPending();
      } else if (!online) {
        wasOffline.current = true;
      }
    });

    return () => {
      unsubQueue();
      unsubNet();
    };
  }, [ownerId]);

  const retryPending = async () => {
    if (!isOnline || syncing) return;
    await syncPending();
  };

  const retryFailed = async () => {
    if (!isOnline || syncing) return;
    await retryFailedOperations(ownerId);
    await syncPending();
  };

  const discardFailed = async () => {
    await discardFailedOperations(ownerId);
  };

  return {
    isOnline,
    pendingCount,
    failedCount,
    syncing,
    retryPending,
    retryFailed,
    discardFailed,
  };
}
