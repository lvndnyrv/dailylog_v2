import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '../lib/supabase';

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function throwIfError(error, fallback) {
  if (error) throw new Error(error.message || fallback);
}

export function useRollCall(classroomId) {
  const [rollCall, setRollCall] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!classroomId) {
      setRollCall(null);
      setLoading(false);
      setRefreshing(false);
      return null;
    }
    if (!quiet) setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_mobile_roll_call', {
      p_classroom_id: classroomId,
    });
    if (!mounted.current) return null;
    if (loadError) {
      setError(loadError);
    } else {
      setRollCall(data || null);
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
    return data || null;
  }, [classroomId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    return load({ quiet: true });
  }, [load]);

  const checkIn = useCallback(async (childId) => {
    const { data, error: mutationError } = await supabase.rpc('mobile_roll_call_check_in', {
      p_child_id: childId,
    });
    throwIfError(mutationError, 'The child could not be checked in.');
    await load({ quiet: true });
    return data;
  }, [load]);

  const markAbsent = useCallback(async (childId, values) => {
    const data = await markChildAbsent(childId, values);
    await load({ quiet: true });
    return data;
  }, [load]);

  const complete = useCallback(async () => {
    const { data, error: mutationError } = await supabase.rpc('complete_mobile_roll_call', {
      p_classroom_id: classroomId,
    });
    throwIfError(mutationError, 'Roll call could not be completed.');
    await load({ quiet: true });
    return data;
  }, [classroomId, load]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  useEffect(() => {
    if (!classroomId) return undefined;
    const refreshQuietly = () => load({ quiet: true });
    const channel = supabase
      .channel(`mobile-roll-call-${classroomId}-${Date.now()}-${Math.random()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'attendance_records',
      }, refreshQuietly)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pickup_plans',
      }, refreshQuietly)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'mobile_roll_call_sessions',
      }, refreshQuietly)
      .subscribe();
    const poll = setInterval(refreshQuietly, 60_000);
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [classroomId, load]);

  return {
    rollCall,
    loading,
    refreshing,
    error,
    load,
    refresh,
    checkIn,
    markAbsent,
    complete,
  };
}

export async function getLatePickupPreview(childId) {
  const { data, error } = await supabase.rpc('get_mobile_late_pickup_preview', {
    p_child_id: childId,
  });
  throwIfError(error, 'Late-pickup details are unavailable.');
  return data;
}

export async function markChildAbsent(childId, values) {
  const { data, error } = await supabase.rpc('mobile_mark_child_absent', {
    p_child_id: childId,
    p_reason: values.reason,
    p_note: values.note || null,
    p_notify_office: values.notifyOffice !== false,
  });
  throwIfError(error, 'The absence could not be saved.');
  return data;
}

export async function completeMobileLatePickup(passId, notes) {
  const { data, error } = await supabase.rpc('complete_mobile_late_pickup', {
    p_pass_id: passId,
    p_notes: notes || null,
  });
  throwIfError(error, 'The late pickup could not be completed.');
  const row = firstRow(data);
  if (!row) throw new Error('The late pickup could not be completed.');
  return row;
}
