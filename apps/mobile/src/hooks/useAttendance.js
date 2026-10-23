import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { mutate } from '../lib/offlineQueue';
import { newId } from '../lib/uuid';
import { showToast } from '../components/Toast';
import { format } from 'date-fns';
import { useClassroom } from './useClassroom';

const EMPTY_ATTENDANCE = {};

/**
 * Attendance hook — classroom attendance status and arrivals for a given date.
 * One attendance_records row per child per day (unique child_id+date).
 *
 * Returns:
 *  - attendance: { [childId]: { id, checked_in_at, checked_out_at } }
 *  - checkIn(childId)
 *  - presentCount / checkedOutCount
 */
export function useAttendance(classroomId, date = new Date(), educatorId) {
  const [attendanceRows, setAttendance] = useState({});
  const [loadedScope, setLoadedScope] = useState(null);
  const latestRequest = useRef(0);
  const { classrooms = [] } = useClassroom();
  const roomKey = (classrooms.find(room => room.id === classroomId)?.member_room_ids || [classroomId]).join(',');
  const dateStr = format(date, 'yyyy-MM-dd');
  const scope = `${classroomId || ''}:${roomKey}:${dateStr}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const attendance = loadedScope === scope ? attendanceRows : EMPTY_ATTENDANCE;

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    const stillCurrent = () => request === latestRequest.current && scope === currentScope.current;
    if (!classroomId) { setAttendance({}); setLoadedScope(scope); return; }
    const { data: kids } = await supabase
      .from('children').select('id')
      .in('classroom_id', roomKey.split(',')).is('archived_at', null);
    if (!stillCurrent()) return;
    if (!kids?.length) { setAttendance({}); setLoadedScope(scope); return; }

    const { data: records } = await supabase
      .from('attendance_records')
      .select('id, child_id, checked_in_at, checked_out_at, status, method, absence_reason, notes, absence_report_id, absence_reported_at')
      .in('child_id', kids.map(k => k.id))
      .eq('date', dateStr);
    if (!stillCurrent()) return;

    const map = {};
    (records || []).forEach(r => { map[r.child_id] = r; });
    setAttendance(map);
    setLoadedScope(scope);
  }, [classroomId, dateStr, roomKey, scope]);

  useEffect(() => {
    load();
    return () => { latestRequest.current += 1; };
  }, [load]);

  async function checkIn(childId) {
    const actionScope = scope;
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
        data: { checked_in_at: existing.checked_in_at || now, checked_in_by: educatorId, checked_out_at: null, checked_out_by: null, status: 'present' },
      });
      if (error && actionScope === currentScope.current) { setAttendance(prev => ({ ...prev, [childId]: existing })); showToast(error.message || 'Check-in failed', 'error'); }
      return;
    }

    const id = newId();
    const row = { id, child_id: childId, date: dateStr, checked_in_at: now, checked_in_by: educatorId, status: 'present', method: 'educator' };
    setAttendance(prev => ({ ...prev, [childId]: row }));
    const { error } = await mutate({
      type: 'upsert', table: 'attendance_records', data: row,
      onConflict: 'child_id,date', ignoreDuplicates: false,
    });
    if (error && actionScope === currentScope.current) {
      setAttendance(prev => { const next = { ...prev }; delete next[childId]; return next; });
      showToast(error.message || 'Check-in failed', 'error');
    }
  }

  function getStatus(childId) {
    const rec = attendance[childId];
    if (!rec) return 'awaited';
    if (!rec.checked_in_at) {
      if (rec.status === 'late') return 'coming';
      if (rec.status === 'absent') return 'absent';
      return 'awaited';
    }
    if (rec.checked_out_at) return 'departed';
    return 'present';
  }

  const presentCount = Object.values(attendance)
    .filter(r => r.checked_in_at && !r.checked_out_at).length;
  const departedCount = Object.values(attendance)
    .filter(r => r.checked_in_at && r.checked_out_at).length;

  return { attendance, checkIn, getStatus, presentCount, departedCount, refresh: load };
}
