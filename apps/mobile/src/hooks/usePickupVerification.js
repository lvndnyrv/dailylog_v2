import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function throwIfError(error) {
  if (error) throw new Error(error.message || 'Pickup service is unavailable.');
}

function pickupState(person) {
  if (person.is_active) return 'active';
  if (person.approval_status === 'pending') return 'pending';
  if (person.approval_status === 'rejected') return 'rejected';
  return 'removed';
}

export function dedupeParentPickupOptions(rows = []) {
  const unique = new Map();

  rows.forEach((person) => {
    // The list represents people and their current lifecycle state, not an
    // audit log. Retain separate active/removed history while collapsing old
    // repeated test requests for the same person in the same state.
    const key = [
      person.source_type,
      (person.full_name || '').trim().toLocaleLowerCase(),
      pickupState(person),
    ].join(':');
    const current = unique.get(key);
    const requestedAt = Date.parse(person.requested_at || '') || 0;
    const currentRequestedAt = Date.parse(current?.requested_at || '') || 0;
    if (!current || requestedAt >= currentRequestedAt) unique.set(key, person);
  });

  return Array.from(unique.values());
}

export function useTodayPickups(classroomId, operatingRoomKey = '') {
  const scope = `${classroomId || ''}:${operatingRoomKey}`;
  const [result, setResult] = useState({ scope: null, pickups: [], loading: true, error: null });
  const latestRequest = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const current = result.scope === scope;
  const pickups = current ? result.pickups : [];
  const loading = !current || result.loading;
  const error = current ? result.error : null;

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++latestRequest.current;
    const stillCurrent = () => requestId === latestRequest.current && scope === currentScope.current;
    if (!classroomId) {
      setResult({ scope, pickups: [], loading: false, error: null });
      return [];
    }
    setResult(previous => previous.scope === scope && quiet
      ? previous
      : { scope, pickups: previous.scope === scope ? previous.pickups : [], loading: true, error: null });
    const { data, error: queryError } = await supabase.rpc('get_mobile_today_pickups', {
      p_classroom_id: classroomId,
    });
    if (!stillCurrent()) return [];
    if (queryError) {
      setResult({ scope, pickups: [], loading: false, error: queryError });
      return [];
    }
    setResult({ scope, pickups: data || [], loading: false, error: null });
    return data || [];
  }, [classroomId, scope]);

  useEffect(() => {
    load();
    return () => { latestRequest.current += 1; };
  }, [load]);

  // A pickup list also changes when the center's day rolls over, without a
  // database event. Refresh on the clock and when the app returns to front.
  useEffect(() => {
    if (!classroomId) return undefined;
    const timer = setInterval(() => load({ quiet: true }), 60_000);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') load({ quiet: true });
    });
    return () => { clearInterval(timer); appState.remove(); };
  }, [classroomId, load]);

  useEffect(() => {
    if (!classroomId) return undefined;
    const channel = supabase
      .channel(`mobile-pickups:${classroomId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'attendance_records',
      }, () => load({ quiet: true }))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pickup_plans',
      }, () => load({ quiet: true }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [classroomId, load]);

  return { pickups, loading, error, load };
}

export function usePickupSecurityEvents() {
  const [events, setEvents] = useState([]);
  const [canResolve, setCanResolve] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const [{ data, error: queryError }, { data: allowed, error: permissionError }] = await Promise.all([
      supabase
        .from('pickup_security_events')
        .select('id, child_id, attempted_name, notes, status, created_at, resolved_at, child:children(first_name, last_name, classroom_id), reporter:profiles!pickup_security_events_reported_by_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.rpc('has_permission', { p_area: 'attendance', p_action: 'approve' }),
    ]);
    const nextError = queryError || permissionError;
    if (nextError) {
      setError(nextError);
    } else {
      setEvents(data || []);
      setCanResolve(Boolean(allowed));
      setError(null);
    }
    setLoading(false);
    return data || [];
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('mobile-pickup-security-events')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pickup_security_events',
      }, () => load({ quiet: true }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { events, canResolve, loading, error, load };
}

export async function getParentPickupOptions(childId, includeRemoved = true) {
  const { data, error } = await supabase.rpc('get_parent_pickup_options', {
    p_child_id: childId,
    p_include_removed: includeRemoved,
  });
  throwIfError(error);
  return dedupeParentPickupOptions(data || []);
}

export async function createMobilePickupPass(childId, presenter) {
  const { data, error } = await supabase.rpc('create_mobile_pickup_pass', {
    p_child_id: childId,
    p_presenter_profile_id: presenter?.source_type === 'profile' ? presenter.source_id : null,
    p_pickup_id: presenter?.source_type === 'pickup' ? presenter.source_id : null,
    p_scheduled_for: null,
  });
  throwIfError(error);
  const row = firstRow(data);
  if (!row) throw new Error('The pickup pass could not be created.');
  return row;
}

export async function getParentPickupAttendance(childId, date = new Date()) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, child_id, date, status, checked_in_at, checked_out_at, picked_up_by')
    .eq('child_id', childId)
    .eq('date', format(date, 'yyyy-MM-dd'))
    .maybeSingle();
  throwIfError(error);
  return data || null;
}

export async function addAuthorizedPickup(childId, values) {
  const { data, error } = await supabase.rpc('parent_add_authorized_pickup', {
    p_child_id: childId,
    p_full_name: values.fullName,
    p_relationship: values.relationship,
    p_phone: values.phone || null,
  });
  throwIfError(error);
  return firstRow(data);
}

export async function removeAuthorizedPickup(pickupId) {
  const { error } = await supabase.rpc('parent_remove_authorized_pickup', {
    p_pickup_id: pickupId,
  });
  throwIfError(error);
}

export async function getStaffPickupPeople(childId) {
  const [{ data: people, error: peopleError }, { data: canReview, error: permissionError }] = await Promise.all([
    supabase
      .from('child_pickups')
      .select('id, full_name, relationship, phone, is_primary, approval_status, requested_at, reviewed_at, review_note, archived_at')
      .eq('child_id', childId)
      .is('archived_at', null)
      .order('requested_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase.rpc('has_permission', { p_area: 'children', p_action: 'edit' }),
  ]);
  throwIfError(peopleError);
  throwIfError(permissionError);
  return { people: people || [], canReview: Boolean(canReview) };
}

export async function reviewAuthorizedPickup(pickupId, decision, note = null) {
  const { data, error } = await supabase.rpc('review_parent_authorized_pickup', {
    p_pickup_id: pickupId,
    p_decision: decision,
    p_note: note || null,
  });
  throwIfError(error);
  return data;
}

export async function resolvePickupSecurityEvent(eventId) {
  const { data, error } = await supabase
    .from('pickup_security_events')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', eventId)
    .eq('status', 'open')
    .select('id')
    .maybeSingle();
  throwIfError(error);
  if (!data) throw new Error('This pickup alert has already been resolved or is no longer available.');
  return data;
}

export async function verifyMobilePickupPass({ token, code, expectedChildId }) {
  const { data, error } = await supabase.rpc('verify_mobile_pickup_pass', {
    p_token: token || null,
    p_code: code || null,
    p_expected_child_id: expectedChildId || null,
  });
  throwIfError(error);
  const row = firstRow(data);
  if (!row) throw new Error('No matching pickup pass was found.');
  return row;
}

export async function completeMobilePickup(passId) {
  const { data, error } = await supabase.rpc('complete_mobile_pickup', {
    p_pass_id: passId,
  });
  throwIfError(error);
  const row = firstRow(data);
  if (!row) throw new Error('The child could not be checked out.');
  return row;
}

export async function reportUnauthorizedPickup(childId, attemptedName, notes) {
  const { data, error } = await supabase.rpc('report_unauthorized_pickup', {
    p_child_id: childId,
    p_attempted_name: attemptedName || null,
    p_notes: notes || null,
  });
  throwIfError(error);
  return data;
}
