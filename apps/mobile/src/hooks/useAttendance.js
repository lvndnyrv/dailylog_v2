import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { mutate } from '../lib/offlineQueue';
import { newId } from '../lib/uuid';
import { showToast } from '../components/Toast';
import { format } from 'date-fns';

/**
 * Attendance hook — check-in / check-out for a classroom on a given date.
 * One attendance_records row per child per day (unique child_id+date).
 *
 * Returns:
 *  - attendance: { [childId]: { id, checked_in_at, checked_out_at } }
 *  - checkIn(childId), checkOut(childId), undoCheckIn(childId)
 *  - presentCount / checkedOutCount
 */
export function useAttendance(classroomId, date = new Date(), educatorId) {
  const [attendance, setAttendance] = useState({});
  const dateStr = format(date, 'yyyy-MM-dd');

  const load = useCallback(async () => {
    if (!classroomId) return;
    const { data: kids } = await supabase
      .from('children').select('id')
      .eq('classroom_id', classroomId).is('archived_at', null);
    if (!kids?.length) { setAttendance({}); return; }

    const { data: records } = await supabase
      .from('attendance_records')
      .select('id, child_id, checked_in_at, checked_out_at')
      .in('child_id', kids.map(k => k.id))
      .eq('date', dateStr);

    const map = {};
    (records || []).forEach(r => { map[r.child_id] = r; });
    setAttendance(map);
  }, [classroomId, dateStr]);

  useEffect(() => { load(); }, [load]);

  async function checkIn(childId) {
    const existing = attendance[childId];
    const now = new Date().toISOString();

    if (existing) {
      // Re-check-in (e.g. undo checkout): clear checkout
      setAttendance(prev => ({
        ...prev,
        [childId]: { ...existing, checked_in_at: existing.checked_in_at || now, checked_out_at: null },
      }));
      const { error } = await mutate({
        type: 'update', table: 'attendance_records', id: existing.id,
        data: { checked_in_at: existing.checked_in_at || now, checked_in_by: educatorId, checked_out_at: null, checked_out_by: null },
      });
      if (error) { setAttendance(prev => ({ ...prev, [childId]: existing })); showToast('Check-in failed', 'error'); }
      return;
    }

    const id = newId();
    const row = { id, child_id: childId, date: dateStr, checked_in_at: now, checked_in_by: educatorId };
    setAttendance(prev => ({ ...prev, [childId]: row }));
    const { error } = await mutate({
      type: 'upsert', table: 'attendance_records', data: row,
      onConflict: 'child_id,date', ignoreDuplicates: false,
    });
    if (error) {
      setAttendance(prev => { const next = { ...prev }; delete next[childId]; return next; });
      showToast('Check-in failed', 'error');
    }
  }

  async function checkOut(childId) {
    const existing = attendance[childId];
    if (!existing?.checked_in_at) return;
    const now = new Date().toISOString();

    setAttendance(prev => ({
      ...prev,
      [childId]: { ...existing, checked_out_at: now },
    }));
    const { error } = await mutate({
      type: 'update', table: 'attendance_records', id: existing.id,
      data: { checked_out_at: now, checked_out_by: educatorId },
    });
    if (error) {
      setAttendance(prev => ({ ...prev, [childId]: existing }));
      showToast('Check-out failed', 'error');
    }
  }

  function getStatus(childId) {
    const rec = attendance[childId];
    if (!rec?.checked_in_at) return 'absent';
    if (rec.checked_out_at) return 'departed';
    return 'present';
  }

  const presentCount = Object.values(attendance)
    .filter(r => r.checked_in_at && !r.checked_out_at).length;
  const departedCount = Object.values(attendance)
    .filter(r => r.checked_in_at && r.checked_out_at).length;

  return { attendance, checkIn, checkOut, getStatus, presentCount, departedCount, refresh: load };
}

