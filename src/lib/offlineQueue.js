import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';

const QUEUE_KEY = 'dailylog_offline_queue';

// Add an operation to the offline queue
export async function enqueue(operation) {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    queue.push({ ...operation, id: Date.now().toString(), timestamp: new Date().toISOString() });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Offline queue enqueue error:', err);
  }
}

// Replay all queued operations against Supabase
export async function flushQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return;

    const queue = JSON.parse(raw);
    if (!queue.length) return;

    const failed = [];

    for (const op of queue) {
      try {
        let result;
        if (op.type === 'upsert') {
          result = await supabase.from(op.table).upsert(op.data);
        } else if (op.type === 'insert') {
          result = await supabase.from(op.table).insert(op.data);
        } else if (op.type === 'update') {
          result = await supabase.from(op.table).update(op.data).eq('id', op.id);
        } else if (op.type === 'delete') {
          result = await supabase.from(op.table).delete().eq('id', op.id);
        }

        if (result?.error) {
          console.warn(`Queue replay failed for op ${op.id}:`, result.error);
          failed.push(op);
        }
      } catch (err) {
        console.error('Queue replay error:', err);
        failed.push(op);
      }
    }

    // Keep only the ones that failed
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
    if (failed.length === 0) {
      console.log('Offline queue flushed successfully');
    } else {
      console.warn(`${failed.length} operations still pending after flush`);
    }
  } catch (err) {
    console.error('Offline queue flush error:', err);
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
}
