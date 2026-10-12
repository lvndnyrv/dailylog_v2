import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';

export function useParentIncidents(childId) {
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
    const { data, error: loadError } = await supabase.rpc('get_parent_incident_hub', {
      p_child_id: childId,
    });
    setLoading(false);
    setRefreshing(false);
    if (loadError) {
      const message = loadError.message || 'Incident reports could not be loaded.';
      setError(message);
      throw new Error(message);
    }
    setHub(data || null);
    return data || null;
  }, [childId]);

  const acknowledge = useCallback(async (incidentId, signedName) => {
    const { data, error: acknowledgeError } = await supabase.rpc('acknowledge_parent_incident', {
      p_incident_id: incidentId,
      p_signed_name: signedName,
    });
    if (acknowledgeError) {
      throw new Error(acknowledgeError.message || 'The acknowledgment could not be submitted.');
    }
    await refresh({ quiet: true });
    return data;
  }, [refresh]);

  const getPhotoUrl = useCallback(async (path) => {
    const { data, error: photoError } = await supabase.storage
      .from('incident-photos')
      .createSignedUrl(path, 3600);
    if (photoError) return null;
    return data?.signedUrl || null;
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!childId) return undefined;
    const channelInstance = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`parent-incident-hub:${childId}:${channelInstance}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incident_reports', filter: `child_id=eq.${childId}`,
      }, () => refresh({ quiet: true }).catch(() => {}))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incident_acknowledgments', filter: `child_id=eq.${childId}`,
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
    acknowledge,
    getPhotoUrl,
  };
}
