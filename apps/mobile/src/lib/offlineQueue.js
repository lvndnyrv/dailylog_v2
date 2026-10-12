import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';

const QUEUE_KEY = 'dailylog_offline_queue';
const FAILED_QUEUE_KEY = 'dailylog_failed_offline_queue';
const MAX_SERVER_ATTEMPTS = 3;

// AsyncStorage has no compare-and-swap operation. Serialize every queue
// mutation so a write arriving during replay cannot be overwritten by the
// replay's final storage update.
let storageChain = Promise.resolve();
const withStorageLock = task => {
  const result = storageChain.then(task, task);
  storageChain = result.catch(() => {});
  return result;
};

const listeners = new Set();

function parseQueue(raw) {
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Stored offline changes are invalid');
  return value;
}

async function readQueues() {
  const [[, pendingRaw], [, failedRaw]] = await AsyncStorage.multiGet([
    QUEUE_KEY,
    FAILED_QUEUE_KEY,
  ]);
  return {
    pending: parseQueue(pendingRaw),
    failed: parseQueue(failedRaw),
  };
}

export function subscribeQueue(ownerId, listener) {
  const subscription = { ownerId, listener };
  listeners.add(subscription);
  return () => listeners.delete(subscription);
}

async function emitChange() {
  for (const subscription of listeners) {
    try {
      const status = await getQueueStatus(subscription.ownerId);
      subscription.listener(status.pendingCount, status.failedCount);
    } catch {
      // A display listener must never interrupt durable queue handling.
    }
  }
}

function execute(operation) {
  if (operation.type === 'insert') {
    return supabase
      .from(operation.table)
      .upsert(operation.data, { onConflict: 'id', ignoreDuplicates: true });
  }
  if (operation.type === 'upsert') {
    const options = operation.onConflict
      ? { onConflict: operation.onConflict, ignoreDuplicates: !!operation.ignoreDuplicates }
      : undefined;
    return supabase.from(operation.table).upsert(operation.data, options);
  }
  if (operation.type === 'update') {
    return supabase.from(operation.table).update(operation.data).eq('id', operation.id);
  }
  if (operation.type === 'delete') {
    return supabase.from(operation.table).delete().eq('id', operation.id);
  }
  if (operation.type === 'rpc') {
    return supabase.rpc(operation.fn, operation.args || {});
  }
  return Promise.resolve({
    error: { message: `Unknown queue operation type: ${operation.type}` },
  });
}

async function isOnline() {
  try {
    const state = await NetInfo.fetch();
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

function storageError(error) {
  return {
    message: 'This change could not be saved on this device. Free some storage and try again.',
    cause: error,
  };
}

/**
 * Run a write now, or durably queue it if connectivity is unavailable.
 * Server validation and permission errors are returned to the caller rather
 * than queued. A queued result is only reported after AsyncStorage succeeds.
 */
export async function mutate(operation) {
  if (!(await isOnline())) {
    try {
      await enqueue(operation);
      return { queued: true, error: null };
    } catch (error) {
      return { queued: false, error: storageError(error) };
    }
  }

  try {
    const result = await execute(operation);
    if (result?.error) return { error: result.error, queued: false };
    return { data: result?.data ?? null, error: null, queued: false };
  } catch (networkError) {
    try {
      await enqueue(operation);
      return { queued: true, error: null };
    } catch (error) {
      return { queued: false, error: storageError(error || networkError) };
    }
  }
}

export async function enqueue(operation) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const ownerId = session?.user?.id;
  if (!ownerId) throw new Error('No signed-in account is available for offline storage');

  await withStorageLock(async () => {
    const { pending } = await readQueues();
    pending.push({
      ...operation,
      ownerId,
      opId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      attempts: 0,
    });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(pending));
  });
  await emitChange();
}

/**
 * Replay queued operations in order. Deterministic server rejections remain
 * pending for three attempts, then move to a visible failed queue. They are
 * never counted as synced and are never silently discarded.
 */
export async function flushQueue(ownerId) {
  if (!ownerId) return { flushed: 0, remaining: 0, failed: 0 };
  let summary;
  try {
    summary = await withStorageLock(async () => {
      const { pending, failed } = await readQueues();
      const remaining = pending.filter(operation => operation.ownerId && operation.ownerId !== ownerId);
      const current = pending.filter(operation => !operation.ownerId || operation.ownerId === ownerId);
      const failedChanges = [...failed];
      let flushed = 0;

      for (const queuedOperation of current) {
        // Pre-scope queue entries are not replayed automatically because their
        // originating account cannot be proven. Surface them for review under
        // the currently signed-in account instead.
        if (!queuedOperation.ownerId) {
          failedChanges.push({
            ...queuedOperation,
            ownerId,
            lastError: 'This older offline change needs confirmation before retrying.',
            failedAt: new Date().toISOString(),
          });
          continue;
        }
        const operation = queuedOperation;
        try {
          const result = await execute(operation);
          if (!result?.error) {
            flushed += 1;
            continue;
          }

          const attempts = (operation.attempts || 0) + 1;
          if (attempts < MAX_SERVER_ATTEMPTS) {
            remaining.push({
              ...operation,
              attempts,
              lastError: result.error.message || 'The server rejected this change',
            });
          } else {
            failedChanges.push({
              ...operation,
              attempts,
              lastError: result.error.message || 'The server rejected this change',
              failedAt: new Date().toISOString(),
            });
          }
        } catch {
          // A transport failure does not consume a server attempt.
          remaining.push(operation);
        }
      }

      await AsyncStorage.multiSet([
        [QUEUE_KEY, JSON.stringify(remaining)],
        [FAILED_QUEUE_KEY, JSON.stringify(failedChanges)],
      ]);

      return {
        flushed,
        remaining: remaining.filter(operation => operation.ownerId === ownerId).length,
        failed: failedChanges.filter(operation => operation.ownerId === ownerId).length,
      };
    });
  } catch (error) {
    console.error('Offline queue flush error:', error);
    const status = await getQueueStatus(ownerId);
    summary = {
      flushed: 0,
      remaining: status.pendingCount,
      failed: status.failedCount,
    };
  }

  await emitChange();
  return summary;
}

export async function retryFailedOperations(ownerId) {
  if (!ownerId) return;
  await withStorageLock(async () => {
    const { pending, failed } = await readQueues();
    const mine = failed.filter(operation => operation.ownerId === ownerId);
    const others = failed.filter(operation => operation.ownerId !== ownerId);
    const retried = mine.map(({ lastError, failedAt, ...operation }) => ({
      ...operation,
      attempts: 0,
    }));
    await AsyncStorage.multiSet([
      [QUEUE_KEY, JSON.stringify([...retried, ...pending])],
      [FAILED_QUEUE_KEY, JSON.stringify(others)],
    ]);
  });
  await emitChange();
}

export async function discardFailedOperations(ownerId) {
  if (!ownerId) return;
  await withStorageLock(async () => {
    const { failed } = await readQueues();
    await AsyncStorage.setItem(
      FAILED_QUEUE_KEY,
      JSON.stringify(failed.filter(operation => operation.ownerId !== ownerId)),
    );
  });
  await emitChange();
}

export async function getQueueStatus(ownerId) {
  if (!ownerId) return { pendingCount: 0, failedCount: 0 };
  try {
    const { pending, failed } = await readQueues();
    return {
      pendingCount: pending.filter(operation => !operation.ownerId || operation.ownerId === ownerId).length,
      failedCount: failed.filter(operation => operation.ownerId === ownerId).length,
    };
  } catch {
    return { pendingCount: 0, failedCount: 0 };
  }
}

export async function getQueueLength(ownerId) {
  return (await getQueueStatus(ownerId)).pendingCount;
}

export async function clearQueue(ownerId) {
  if (!ownerId) return;
  await withStorageLock(async () => {
    const { pending } = await readQueues();
    await AsyncStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(pending.filter(operation => operation.ownerId !== ownerId)),
    );
  });
  await emitChange();
}
