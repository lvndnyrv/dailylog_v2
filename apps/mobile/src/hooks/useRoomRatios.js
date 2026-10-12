import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '../lib/supabase';

export function useRoomRatios() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingNudge, setPendingNudge] = useState(null);
  const [coverage, setCoverage] = useState([]);
  const [coverageError, setCoverageError] = useState(null);
  const mounted = useRef(true);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const [live, contexts, invitations] = await Promise.all([
      supabase.rpc('get_mobile_room_ratios'),
      supabase.rpc('get_room_operating_context'),
      supabase.rpc('get_my_room_coverage'),
    ]);
    const data = live.data;
    const loadError = live.error || contexts.error;

    if (!mounted.current) return;
    setCoverageError(invitations.error);
    if (!invitations.error) setCoverage(invitations.data || []);
    if (loadError) {
      setError(loadError);
    } else {
      setRooms((data || []).map(room => ({ ...room, operating: contexts.data?.find(item => item.room_id === room.id) })));
      setError(null);
    }
    if (!quiet) setLoading(false);
  }, []);

  const respondToCoverage = useCallback(async (assignmentId, response) => {
    const { error: responseError } = await supabase.rpc('respond_to_room_coverage', {
      p_assignment: assignmentId, p_response: response,
    });
    if (responseError) { await load({ quiet: true }); throw responseError; }
    await load({ quiet: true });
  }, [load]);

  const loadFloaters = useCallback(async (roomId) => {
    const { data, error: floaterError } = await supabase.rpc(
      'list_available_ratio_floaters',
      { p_classroom_id: roomId }
    );
    if (floaterError) throw floaterError;
    return data || [];
  }, []);

  const assignFloater = useCallback(async (roomId, staffMemberId, minutes = 120) => {
    const { data, error: assignmentError } = await supabase.rpc('assign_ratio_floater', {
      p_classroom_id: roomId,
      p_staff_member_id: staffMemberId,
      p_minutes: minutes,
    });
    if (assignmentError) throw assignmentError;
    await load({ quiet: true });
    return data;
  }, [load]);

  const loadPendingNudge = useCallback(async () => {
    const { data, error: nudgeError } = await supabase
      .from('room_activity_nudges')
      .select('id, classroom_id, message, created_at, classroom:classrooms(name), sender:profiles!room_activity_nudges_sent_by_fkey(full_name)')
      .eq('mode', 'nudge')
      .is('response', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (nudgeError) throw nudgeError;
    if (mounted.current) setPendingNudge(data || null);
    return data || null;
  }, []);

  const respondToNudge = useCallback(async (nudgeId, response) => {
    const { data, error: responseError } = await supabase.rpc('respond_room_activity_nudge', {
      p_nudge_id: nudgeId,
      p_response: response,
    });
    if (responseError) throw responseError;
    if (mounted.current) setPendingNudge(null);
    return data;
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    loadPendingNudge().catch(() => {});

    const refresh = () => load({ quiet: true });
    const channel = supabase
      .channel(`mobile-room-ratios-${Date.now()}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_coverage_assignments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_time_entries' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_combinations' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_activity_nudges' }, () => {
        loadPendingNudge().catch(() => {});
      })
      .subscribe();
    const poll = setInterval(refresh, 60_000);

    return () => {
      mounted.current = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [load, loadPendingNudge]);

  return {
    rooms,
    loading,
    error,
    load,
    loadFloaters,
    assignFloater,
    pendingNudge,
    loadPendingNudge,
    respondToNudge,
    coverage,
    coverageError,
    respondToCoverage,
  };
}
