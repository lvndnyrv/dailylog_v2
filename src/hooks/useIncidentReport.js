import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { enqueue } from '../lib/offlineQueue';
import NetInfo from '@react-native-community/netinfo';

/**
 * Hook for managing incident reports.
 * 
 * Usage:
 *   const { incidents, loading, create, update, submit, acknowledge } = useIncidentReports(childId);
 */
export function useIncidentReports(childId) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!childId) { setLoading(false); return; }
    setLoading(true);

    const { data } = await supabase
      .from('incident_reports')
      .select('*')
      .eq('child_id', childId)
      .order('occurred_at', { ascending: false });

    setIncidents(data || []);
    setLoading(false);
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  // Real-time subscription
  useEffect(() => {
    if (!childId) return;

    const channel = supabase
      .channel(`incidents:${childId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incident_reports',
        filter: `child_id=eq.${childId}`,
      }, (payload) => {
        setIncidents(prev => {
          if (payload.eventType === 'INSERT') return [payload.new, ...prev];
          if (payload.eventType === 'UPDATE') return prev.map(r => r.id === payload.new.id ? payload.new : r);
          if (payload.eventType === 'DELETE') return prev.filter(r => r.id !== payload.old.id);
          return prev;
        });
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [childId]);

  return { incidents, loading, reload: load };
}

/**
 * Hook for a single incident report (create/edit flow).
 */
export function useIncidentForm(incidentId = null) {
  const [report, setReport] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!incidentId) return;
    async function fetch() {
      const { data } = await supabase
        .from('incident_reports')
        .select('*')
        .eq('id', incidentId)
        .single();
      if (data) setReport(data);
    }
    fetch();
  }, [incidentId]);

  async function createDraft(data) {
    setSaving(true);
    const { data: created, error } = await supabase
      .from('incident_reports')
      .insert(data)
      .select()
      .single();
    setSaving(false);
    if (error) return { error };
    setReport(created);
    return { data: created };
  }

  async function updateReport(id, updates) {
    setSaving(true);

    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      await enqueue({ type: 'update', table: 'incident_reports', id, data: updates });
      setReport(prev => prev ? { ...prev, ...updates } : prev);
      setSaving(false);
      return { data: { ...report, ...updates } };
    }

    const { data, error } = await supabase
      .from('incident_reports')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    setSaving(false);
    if (error) return { error };
    setReport(data);
    return { data };
  }

  async function submitReport(id) {
    return updateReport(id, {
      status: 'submitted',
      parent_notified_at: new Date().toISOString(),
    });
  }

  async function acknowledgeReport(id, fullName) {
    return updateReport(id, {
      status: 'acknowledged',
      parent_acknowledged_at: new Date().toISOString(),
      parent_acknowledge_name: fullName,
    });
  }

  async function uploadPhoto(incidentId, childId, uri) {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const path = `${childId}/${incidentId}/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('incident-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) throw uploadError;
      return { path };
    } catch (err) {
      return { error: err };
    }
  }

  async function getPhotoUrl(path) {
    const { data } = await supabase.storage
      .from('incident-photos')
      .createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  }

  return {
    report,
    saving,
    createDraft,
    updateReport,
    submitReport,
    acknowledgeReport,
    uploadPhoto,
    getPhotoUrl,
  };
}

