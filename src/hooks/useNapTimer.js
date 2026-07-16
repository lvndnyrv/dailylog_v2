import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { mutate } from '../lib/offlineQueue';
import { newId } from '../lib/uuid';
import { showToast } from '../components/Toast';
import { format } from 'date-fns';

/**
 * Nap timer hook — manages live nap timers for a classroom.
 * - startNap: creates sleep_entry with end_time = null
 * - endNap: sets end_time
 * - 2.5h soft reminder toast
 * - Auto-close yesterday's open naps on mount
 */
export function useNapTimer(classroomId) {
  const [activeNaps, setActiveNaps] = useState({});
  const reminderInterval = useRef(null);
  const remindedSet = useRef(new Set());
  const today = format(new Date(), 'yyyy-MM-dd');

  const loadActiveNaps = useCallback(async () => {
    if (!classroomId) return;
    const { data: kids } = await supabase
      .from('children').select('id, first_name')
      .eq('classroom_id', classroomId).is('archived_at', null);
    if (!kids?.length) return;

    const childNames = {};
    kids.forEach(k => { childNames[k.id] = k.first_name; });

    const { data: logs } = await supabase
      .from('daily_logs').select('id, child_id')
      .in('child_id', kids.map(k => k.id)).eq('log_date', today);
    if (!logs?.length) { setActiveNaps({}); return; }

    const logToChild = {};
    logs.forEach(l => { logToChild[l.id] = l.child_id; });

    const { data: openSleeps } = await supabase
      .from('sleep_entries').select('id, daily_log_id, start_time')
      .in('daily_log_id', logs.map(l => l.id)).is('end_time', null);

    const naps = {};
    (openSleeps || []).forEach(s => {
      const childId = logToChild[s.daily_log_id];
      if (childId) {
        naps[childId] = {
          sleepEntryId: s.id, startTime: s.start_time,
          logId: s.daily_log_id, childName: childNames[childId] || 'Child',
        };
      }
    });
    setActiveNaps(naps);
  }, [classroomId, today]);

  useEffect(() => { loadActiveNaps(); }, [loadActiveNaps]);

  // Auto-close yesterday's open naps
  useEffect(() => {
    if (!classroomId) return;
    (async () => {
      const { data: kids } = await supabase
        .from('children').select('id')
        .eq('classroom_id', classroomId).is('archived_at', null);
      if (!kids?.length) return;
      const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
      const { data: oldLogs } = await supabase
        .from('daily_logs').select('id')
        .in('child_id', kids.map(k => k.id)).eq('log_date', yesterday);
      if (!oldLogs?.length) return;
      const { data: stale } = await supabase
        .from('sleep_entries').select('id')
        .in('daily_log_id', oldLogs.map(l => l.id)).is('end_time', null);
      if (stale?.length) {
        await supabase.from('sleep_entries')
          .update({ end_time: '23:59' }).in('id', stale.map(s => s.id));
      }
    })();
  }, [classroomId]);

  // 2.5h soft reminder — check every 60 seconds
  useEffect(() => {
    reminderInterval.current = setInterval(() => {
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      Object.entries(activeNaps).forEach(([childId, nap]) => {
        if (!nap.startTime) return;
        const [h, m] = nap.startTime.split(':').map(Number);
        const elapsed = nowMins - (h * 60 + m);
        if (elapsed >= 150 && !remindedSet.current.has(nap.sleepEntryId)) {
          remindedSet.current.add(nap.sleepEntryId);
          const hrs = Math.floor(elapsed / 60);
          const mins = elapsed % 60;
          showToast(`⏰ ${nap.childName} has been napping ${hrs}h ${mins}m`, 'info');
        }
      });
    }, 60000);
    return () => { if (reminderInterval.current) clearInterval(reminderInterval.current); };
  }, [activeNaps]);

  async function startNap(childId, logId, childName = 'Child') {
    const now = format(new Date(), 'HH:mm');
    const id = newId();
    const row = { id, daily_log_id: logId, start_time: now, end_time: null };
    setActiveNaps(prev => ({
      ...prev,
      [childId]: { sleepEntryId: id, startTime: now, logId, childName },
    }));
    const { error } = await mutate({ type: 'insert', table: 'sleep_entries', data: row });
    if (error) {
      setActiveNaps(prev => { const next = { ...prev }; delete next[childId]; return next; });
      showToast(`Couldn't start nap: ${error.message}`, 'error');
    }
  }

  async function endNap(childId, endTimeOverride) {
    const nap = activeNaps[childId];
    if (!nap) return;
    const endTime = endTimeOverride || format(new Date(), 'HH:mm');
    setActiveNaps(prev => { const next = { ...prev }; delete next[childId]; return next; });
    remindedSet.current.delete(nap.sleepEntryId);
    const { error } = await mutate({
      type: 'update', table: 'sleep_entries',
      id: nap.sleepEntryId, data: { end_time: endTime },
    });
    if (error) {
      setActiveNaps(prev => ({ ...prev, [childId]: nap }));
      showToast(`Couldn't end nap: ${error.message}`, 'error');
    }
  }

  function isNapping(childId) { return !!activeNaps[childId]; }

  function getElapsed(childId) {
    const nap = activeNaps[childId];
    if (!nap?.startTime) return '';
    const [h, m] = nap.startTime.split(':').map(Number);
    const now = new Date();
    const elapsed = (now.getHours() * 60 + now.getMinutes()) - (h * 60 + m);
    if (elapsed <= 0) return '0m';
    if (elapsed < 60) return `${elapsed}m`;
    return `${Math.floor(elapsed / 60)}h ${elapsed % 60}m`;
  }

  function getOpenNaps() {
    return Object.entries(activeNaps).map(([childId, nap]) => ({ childId, ...nap }));
  }

  return { activeNaps, startNap, endNap, isNapping, getElapsed, getOpenNaps, refresh: loadActiveNaps };
}

