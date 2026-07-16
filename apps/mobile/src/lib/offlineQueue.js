import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';

const QUEUE_KEY = 'dailylog_offline_queue';

// ─── Queue change events (live pending count in OfflineBanner) ──────────────
const listeners = new Set();

export function subscribeQueue(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function emitChange() {
  const count = await getQueueLength();
  listeners.forEach((fn) => {
    try { fn(count); } catch { /* listener errors are non-fatal */ }
  });
}

// ─── Core execution ──────────────────────────────────────────────────────────
// Inserts are executed as upsert ON CONFLICT (id) DO NOTHING so replaying a
// queued op that already reached the server is a no-op (client supplies the id
// via lib/uuid.newId()).
function execute(op) {
  if (op.type === 'insert') {
    return supabase.from(op.table).upsert(op.data, { onConflict: 'id', ignoreDuplicates: true });
  }
  if (op.type === 'upsert') {
    return supabase.from(op.table).upsert(op.data, op.onConflict ? { onConflict: op.onConflict, ignoreDuplicates: !!op.ignoreDuplicates } : undefined);
  }
  if (op.type === 'update') {
    return supabase.from(op.table).update(op.data).eq('id', op.id);
  }
  if (op.type === 'delete') {
    return supabase.from(op.table).delete().eq('id', op.id);
  }
  if (op.type === 'rpc') {
    // Server-side functions (e.g. acknowledge_incident). Queued RPCs must be
    // idempotent — replaying one that already ran should be a no-op.
    return supabase.rpc(op.fn, op.args || {});
  }
  return Promise.resolve({ error: { message: `Unknown queue op type: ${op.type}` } });
}

async function isOnline() {
  try {
    const state = await NetInfo.fetch();
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return true; // assume online if NetInfo itself fails
  }
}

/**
 * Run a write now if online, or queue it for replay if offline / network fails.
 *
 * op: { type: 'insert'|'upsert'|'update'|'delete', table, data?, id?, onConflict? }
 *     | { type: 'rpc', fn, args? }
 * Returns { data?, error?, queued? }:
 *  - error  → a real (RLS/validation) failure: caller should roll back optimistic state
 *  - queued → accepted locally, will sync on reconnect: keep optimistic state
 */
export async function mutate(op) {
  if (!(await isOnline())) {
    await enqueue(op);
    return { queued: true, error: null };
  }
  try {
    const result = await execute(op);
    if (result?.error) return { error: result.error };
    return { data: result?.data ?? null, error: null };
  } catch (err) {
    // Thrown = network-level failure (not a PostgREST rejection) → queue it
    await enqueue(op);
    return { queued: true, error: null };
  }
}

// Add an operation to the offline queue
export async function enqueue(operation) {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    queue.push({ ...operation, opId: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), timestamp: new Date().toISOString() });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    emitChange();
  } catch (err) {
    console.error('Offline queue enqueue error:', err);
  }
}

/**
 * Replay all queued operations against Supabase (in order).
 * Returns { flushed, remaining }.
 */
export async function flushQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return { flushed: 0, remaining: 0 };

    const queue = JSON.parse(raw);
    if (!queue.length) return { flushed: 0, remaining: 0 };

    const failed = [];

    for (const op of queue) {
      try {
        const result = await execute(op);
        if (result?.error) {
          console.warn(`Queue replay rejected for op ${op.opId}:`, result.error.message);
          // Rejected by the server (RLS/validation) — dropping it would lose
          // data silently; keeping it forever would jam the queue. Drop after
          // 3 failed attempts.
          const attempts = (op.attempts || 0) + 1;
          if (attempts < 3) failed.push({ ...op, attempts });
        }
      } catch (err) {
        // Network failure — keep for next flush, don't count attempts
        failed.push(op);
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
    emitChange();

    const flushed = queue.length - failed.length;
    if (failed.length === 0) console.log('Offline queue flushed successfully');
    else console.warn(`${failed.length} operations still pending after flush`);
    return { flushed, remaining: failed.length };
  } catch (err) {
    console.error('Offline queue flush error:', err);
    return { flushed: 0, remaining: await getQueueLength() };
  }
}

// Get current queue length (for showing "X changes pending" UI)
export async function getQueueLength() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw).length : 0;
  } catch {
    return 0;
  }
}

// Clear the queue entirely (e.g. after a full refresh from server)
export async function clearQueue() {
  await AsyncStorage.removeItem(QUEUE_KEY);
  emitChange();
}
