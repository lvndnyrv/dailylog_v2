import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export function useRoomRatios() {
  const { profile } = useAuth();
  const isEducator = profile?.role === 'educator';
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingNudge, setPendingNudge] = useState(null);
  const [nudgeUnavailable, setNudgeUnavailable] = useState(false);
  const [coverage, setCoverage] = useState([]);
  const [coverageError, setCoverageError] = useState(null);
  const mounted = useRef(true);
  const latestRequest = useRef(0);
  const latestNudgeRequest = useRef(0);
  const requestedNudgeId = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const request = ++latestRequest.current;
    if (!quiet) setLoading(true);
    const [live, contexts, invitations] = await Promise.all([
      supabase.rpc('get_mobile_room_ratios'),
      supabase.rpc('get_room_operating_context'),
      isEducator ? supabase.rpc('get_my_room_coverage') : Promise.resolve({ data: [], error: null }),
    ]);
    const data = live.data;
    const loadError = live.error || contexts.error;

    // Realtime, focus and the clock can all refresh this screen at once. A
    // response from an earlier operating-room window must not replace newer
    // ratio counts, room context or coverage invitations.
    if (!mounted.current || request !== latestRequest.current) return;
    setCoverageError(invitations.error);
    if (!invitations.error) setCoverage(invitations.data || []);
    if (loadError) {
      setRooms([]);
      setError(loadError);
    } else {
      setRooms((data || []).map(room => ({ ...room, operating: contexts.data?.find(item => item.room_id === room.id) })));
      setError(null);
    }
    setLoading(false);
  }, [isEducator]);

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

  const loadPendingNudge = useCallback(async (targetId = undefined) => {
    if (!isEducator) {
      latestNudgeRequest.current += 1;
      requestedNudgeId.current = null;
      setPendingNudge(null);
      setNudgeUnavailable(false);
      return null;
    }
    if (targetId !== undefined && targetId !== requestedNudgeId.current) {
      requestedNudgeId.current = targetId;
      // Never leave a previous room's actionable card visible while a newly
      // opened notification is being resolved.
      setPendingNudge(null);
      setNudgeUnavailable(false);
    }
    const activeTarget = requestedNudgeId.current;
    const request = ++latestNudgeRequest.current;
    let query = supabase
      .from('room_activity_nudges')
      .select('id, classroom_id, message, created_at, classroom:classrooms(name), sender:profiles!room_activity_nudges_sent_by_fkey(full_name)')
      .eq('mode', 'nudge')
      .is('response', null);
    query = activeTarget
      ? query.eq('id', activeTarget)
      : query.order('created_at', { ascending: false }).limit(1);
    const { data, error: nudgeError } = await query.maybeSingle();
    if (!mounted.current || request !== latestNudgeRequest.current) return null;
    if (nudgeError) {
      setPendingNudge(null);
      setNudgeUnavailable(false);
      throw nudgeError;
    }
    setPendingNudge(data || null);
    setNudgeUnavailable(Boolean(activeTarget && !data));
    return data || null;
  }, [isEducator]);

  const respondToNudge = useCallback(async (nudgeId, response) => {
    latestNudgeRequest.current += 1;
    const { data, error: responseError } = await supabase.rpc('respond_room_activity_nudge', {
      p_nudge_id: nudgeId,
      p_response: response,
    });
    if (!responseError && requestedNudgeId.current === nudgeId) requestedNudgeId.current = null;
    if (mounted.current) setPendingNudge(null);
    await loadPendingNudge().catch(() => {});
    if (responseError) throw responseError;
    return data;
  }, [loadPendingNudge]);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_combinations' }, () => {
        refresh();
        loadPendingNudge().catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_activity_nudges' }, () => {
        loadPendingNudge().catch(() => {});
      })
      .subscribe();
    const poll = setInterval(() => {
      refresh();
      loadPendingNudge().catch(() => {});
    }, 60_000);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
        loadPendingNudge().catch(() => {});
      }
    });

    return () => {
      mounted.current = false;
      latestRequest.current += 1;
      latestNudgeRequest.current += 1;
      clearInterval(poll);
      appState.remove();
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
    nudgeUnavailable,
    loadPendingNudge,
    respondToNudge,
    coverage,
    coverageError,
    respondToCoverage,
  };
}
