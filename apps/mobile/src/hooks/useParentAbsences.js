import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';

function rpcMessage(error, fallback) {
  return error?.message || fallback;
}

export function useParentAbsences(childId) {
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(Boolean(childId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!childId) {
      setHub(null);
      setLoading(false);
      return null;
    }
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_parent_absence_hub', {
      p_child_id: childId,
    });
    setLoading(false);
    setRefreshing(false);
    if (loadError) {
      const message = rpcMessage(loadError, 'Absence information could not be loaded.');
      setError(message);
      throw new Error(message);
    }
    setHub(data || null);
    return data || null;
  }, [childId]);

  const submit = useCallback(async ({ startsOn, endsOn, reason, note, reportId = null }) => {
    if (!childId) throw new Error('Choose a child before reporting an absence.');
    const { data, error: saveError } = await supabase.rpc('report_parent_absence', {
      p_child_id: childId,
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_reason: reason,
      p_note: note?.trim() || null,
      p_report_id: reportId,
    });
    if (saveError) throw new Error(rpcMessage(saveError, 'The absence could not be saved.'));
    await refresh({ quiet: true });
    return data;
  }, [childId, refresh]);

  const cancel = useCallback(async (reportId) => {
    const { data, error: cancelError } = await supabase.rpc('cancel_parent_absence', {
      p_report_id: reportId,
    });
    if (cancelError) throw new Error(rpcMessage(cancelError, 'The absence could not be cancelled.'));
    await refresh({ quiet: true });
    return data;
  }, [refresh]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!childId) return undefined;
    const channel = supabase
      .channel(`parent-absences:${childId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'parent_absence_reports', filter: `child_id=eq.${childId}`,
      }, () => refresh({ quiet: true }).catch(() => {}))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'attendance_records', filter: `child_id=eq.${childId}`,
      }, () => refresh({ quiet: true }).catch(() => {}))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [childId, refresh]);

  return {
    hub,
    reports: hub?.reports || [],
    loading,
    refreshing,
    error,
    refresh,
    submit,
    cancel,
  };
}
