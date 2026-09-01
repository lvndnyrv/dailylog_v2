import { useCallback, useEffect, useState } from 'react';
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

export function useTodayPickups(classroomId) {
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!classroomId) {
      setPickups([]);
      setLoading(false);
      return [];
    }
    if (!quiet) setLoading(true);
    const { data, error: queryError } = await supabase.rpc('get_mobile_today_pickups', {
      p_classroom_id: classroomId,
    });
    if (queryError) {
      setError(queryError);
      setLoading(false);
      return [];
    }
    setError(null);
    setPickups(data || []);
    setLoading(false);
    return data || [];
  }, [classroomId]);

  useEffect(() => {
    load();
  }, [load]);

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
