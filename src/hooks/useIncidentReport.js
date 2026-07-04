import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { mutate } from '../lib/offlineQueue';
import { newId } from '../lib/uuid';

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
    // Client-generated id → drafts can be created offline (e.g. on the
    // playground) and replay idempotently when back online.
    const row = { id: newId(), ...data };
    const { error, queued } = await mutate({ type: 'insert', table: 'incident_reports', data: row });
    setSaving(false);
    if (error) return { error };
    setReport(row);
    return { data: row, queued };
  }

  async function updateReport(id, updates) {
    setSaving(true);
    const { error, queued } = await mutate({ type: 'update', table: 'incident_reports', id, data: updates });
    setSaving(false);
    if (error) return { error };
    const merged = { ...(report || {}), ...updates };
    setReport(merged);
    return { data: merged, queued };
  }

  async function submitReport(id) {
    return updateReport(id, {
      status: 'submitted',
      parent_notified_at: new Date().toISOString(),
    });
  }

  // Phase 2 security: parents have no UPDATE grant on incident_reports.
  // Acknowledgment goes through the column-safe acknowledge_incident() RPC,
  // which validates the parent↔child link server-side and only touches
  // status / parent_acknowledged_at / parent_acknowledge_name. Idempotent
  // (only acts on status='submitted'), so offline replay is safe.
  async function acknowledgeReport(id, fullName) {
    setSaving(true);
    const { error, queued } = await mutate({
      type: 'rpc',
      fn: 'acknowledge_incident',
      args: { p_incident_id: id, p_full_name: fullName },
    });
    setSaving(false);
    if (error) return { error };
    const merged = {
      ...(report || {}),
      status: 'acknowledged',
      parent_acknowledged_at: new Date().toISOString(),
      parent_acknowledge_name: fullName,
    };
    setReport(merged);
    return { data: merged, queued };
  }

  async function uploadPhoto(incidentId, childId, uri) {
    try {
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${childId}/${incidentId}/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('incident-photos')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: false });

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

