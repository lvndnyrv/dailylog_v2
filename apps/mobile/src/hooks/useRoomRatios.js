import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '../lib/supabase';

export function useRoomRatios() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_mobile_room_ratios');

    if (!mounted.current) return;
    if (loadError) {
      setError(loadError);
    } else {
      setRooms(data || []);
      setError(null);
    }
    if (!quiet) setLoading(false);
  }, []);

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

  useEffect(() => {
    mounted.current = true;
    load();

    const refresh = () => load({ quiet: true });
    const channel = supabase
      .channel(`mobile-room-ratios-${Date.now()}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_coverage_assignments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_time_entries' }, refresh)
      .subscribe();
    const poll = setInterval(refresh, 60_000);

    return () => {
      mounted.current = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [load]);

  return {
    rooms,
    loading,
    error,
    load,
    loadFloaters,
    assignFloater,
  };
}
