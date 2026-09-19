import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  format,
  startOfWeek,
} from 'date-fns';

import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export function entryMinutes(entry, now = new Date()) {
  if (!entry?.clocked_in_at) return 0;
  const started = new Date(entry.clocked_in_at);
  const ended = entry.clocked_out_at ? new Date(entry.clocked_out_at) : now;
  const elapsed = Math.floor((ended.getTime() - started.getTime()) / 60000);
  return Math.max(0, elapsed - Number(entry.break_minutes || 0));
}

export function formatMinutes(minutes) {
  const safeMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (!hours) return `${remainder}m`;
  return `${hours}h ${remainder}m`;
}

export function localDateKey(value) {
  return format(value instanceof Date ? value : new Date(value), 'yyyy-MM-dd');
}

export function useStaffTime() {
  const { profile } = useAuth();
  const channelSuffix = useRef(Math.random().toString(36).slice(2)).current;
  const [staffMember, setStaffMember] = useState(null);
  const [regularSchedule, setRegularSchedule] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [entries, setEntries] = useState([]);
  const [requests, setRequests] = useState([]);
  const [leaveSummary, setLeaveSummary] = useState({ annualDays: 0, usedDays: 0, remainingDays: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mutating, setMutating] = useState(false);

  const weekStart = useMemo(
    () => startOfWeek(new Date(), { weekStartsOn: 1 }),
    [],
  );
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const load = useCallback(async () => {
    if (!profile?.id) {
      setStaffMember(null);
      setRegularSchedule([]);
      setShifts([]);
      setEntries([]);
      setRequests([]);
      setLeaveSummary({ annualDays: 0, usedDays: 0, remainingDays: 0 });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const memberResult = await supabase
      .from('staff_members')
      .select('id, daycare_id, profile_id, job_title, annual_paid_leave_days')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .is('archived_at', null)
      .maybeSingle();

    if (memberResult.error || !memberResult.data) {
      setStaffMember(null);
      setRegularSchedule([]);
      setShifts([]);
      setEntries([]);
      setRequests([]);
      setLeaveSummary({ annualDays: 0, usedDays: 0, remainingDays: 0 });
      setError(memberResult.error || new Error('No active staff record was found.'));
      setLoading(false);
      return;
    }

    const member = memberResult.data;
    const [scheduleResult, shiftResult, entryResult, requestResult] = await Promise.all([
      supabase
        .from('staff_regular_schedules')
        .select('id, weekday, starts_local, ends_local, unpaid_break_minutes, classroom:classrooms(id, name)')
        .eq('staff_member_id', member.id)
        .order('weekday'),
      supabase
        .from('staff_shifts')
        .select('*, classroom:classrooms(id, name)')
        .eq('staff_member_id', member.id)
        .gte('starts_at', weekStart.toISOString())
        .lt('starts_at', weekEnd.toISOString())
        .in('status', ['published', 'completed'])
        .order('starts_at'),
      supabase
        .from('staff_time_entries')
        .select('*, classroom:classrooms(id, name)')
        .eq('staff_member_id', member.id)
        .gte('clocked_in_at', weekStart.toISOString())
        .lt('clocked_in_at', weekEnd.toISOString())
        .order('clocked_in_at'),
      supabase.rpc('get_mobile_time_off_status'),
    ]);

    const firstError = scheduleResult.error || shiftResult.error || entryResult.error || requestResult.error;
    if (firstError) {
      setError(firstError);
    }

    setStaffMember(member);
    setRegularSchedule(scheduleResult.data || []);
    setShifts(shiftResult.data || []);
    setEntries(entryResult.data || []);
    setRequests(requestResult.data?.requests || []);
    setLeaveSummary({
      annualDays: Number(requestResult.data?.annualDays || member.annual_paid_leave_days || 0),
      usedDays: Number(requestResult.data?.usedDays || 0),
      remainingDays: Number(requestResult.data?.remainingDays || 0),
    });
    setLoading(false);
  }, [profile?.id, weekEnd, weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!staffMember?.id) return undefined;
    const channel = supabase
      .channel(`mobile-time-off:${staffMember.id}:${channelSuffix}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_shifts',
          filter: `staff_member_id=eq.${staffMember.id}`,
        },
        () => load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_regular_schedules',
          filter: `staff_member_id=eq.${staffMember.id}`,
        },
        () => load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_time_off_requests',
          filter: `staff_member_id=eq.${staffMember.id}`,
        },
        () => load(),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [channelSuffix, load, staffMember?.id]);

  const openEntry = useMemo(
    () => entries.find(entry => !entry.clocked_out_at) || null,
    [entries],
  );

  async function runMutation(fn, args) {
    setMutating(true);
    const result = await supabase.rpc(fn, args);
    setMutating(false);
    if (!result.error) await load();
    return result;
  }

  const clockIn = useCallback(
    classroomId => runMutation('clock_in', {
      p_classroom_id: classroomId || null,
      p_at: new Date().toISOString(),
    }),
    [load],
  );

  const clockOut = useCallback(
    () => runMutation('clock_out', {
      p_at: new Date().toISOString(),
      p_break_minutes: 0,
    }),
    [load],
  );

  const requestTimeOff = useCallback(
    ({ startsOn, endsOn, kind, reason }) => runMutation('request_time_off', {
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_kind: kind,
      p_reason: reason?.trim() || null,
    }),
    [load],
  );

  const rerequestTimeOff = useCallback(
    ({ previousRequestId, startsOn, endsOn, kind, reason }) => runMutation('rerequest_mobile_time_off', {
      p_previous_request_id: previousRequestId,
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_kind: kind,
      p_reason: reason?.trim() || null,
    }),
    [load],
  );

  const withdrawTimeOff = useCallback(
    requestId => runMutation('withdraw_mobile_time_off_request', {
      p_request_id: requestId,
    }),
    [load],
  );

  return {
    staffMember,
    regularSchedule,
    shifts,
    entries,
    requests,
    openEntry,
    weekStart,
    weekEnd,
    annualPaidLeaveDays: leaveSummary.annualDays,
    paidLeaveUsed: leaveSummary.usedDays,
    paidLeaveRemaining: leaveSummary.remainingDays,
    loading,
    mutating,
    error,
    reload: load,
    clockIn,
    clockOut,
    requestTimeOff,
    rerequestTimeOff,
    withdrawTimeOff,
  };
}
