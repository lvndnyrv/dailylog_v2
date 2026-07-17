import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export interface StaffShiftRow {
  id: string;
  starts_at: string;
  ends_at: string;
  unpaid_break_minutes: number;
  status: string;
  notes: string | null;
  staff: {
    id: string;
    profile: {
      id: string;
      full_name: string;
      classroom: { id: string; name: string } | null;
    } | null;
  } | null;
  classroom: { id: string; name: string } | null;
}
export interface StaffTimeEntryRow {
  id: string;
  clocked_in_at: string;
  clocked_out_at: string | null;
  break_minutes: number;
  source: string;
  status: string;
  notes: string | null;
  staff: {
    id: string;
    profile: {
      id: string;
      full_name: string;
      classroom: { id: string; name: string } | null;
    } | null;
  } | null;
  classroom: { id: string; name: string } | null;
}

export interface StaffTimeOffRequestRow {
  id: string;
  starts_on: string;
  ends_on: string;
  kind: string;
  status: string;
  reason: string | null;
  decision_notes: string | null;
  reviewed_at: string | null;
  staff: {
    id: string;
    profile: {
      id: string;
      full_name: string;
      classroom: { id: string; name: string } | null;
    } | null;
  } | null;
}

const SHIFT_SELECT = `id, starts_at, ends_at, unpaid_break_minutes, status, notes,
  staff:staff_members(id, profile:profiles(id, full_name,
    classroom:classrooms!profiles_classroom_id_fkey(id, name))), classroom:classrooms(id, name)`;
const TIME_SELECT = `id, clocked_in_at, clocked_out_at, break_minutes, source, status, notes,
  staff:staff_members(id, profile:profiles(id, full_name,
    classroom:classrooms!profiles_classroom_id_fkey(id, name))), classroom:classrooms(id, name)`;
const TIME_OFF_SELECT = `id, starts_on, ends_on, kind, status, reason, decision_notes, reviewed_at,
  staff:staff_members(id, profile:profiles(id, full_name,
    classroom:classrooms!profiles_classroom_id_fkey(id, name)))`;

export async function listStaffShifts(client: Client, from: string, to: string): Promise<StaffShiftRow[]> {
  const { data, error } = await client
    .from('staff_shifts')
    .select(SHIFT_SELECT)
    .lt('starts_at', to)
    .gt('ends_at', from)
    .order('starts_at');
  if (error) throw error;
  return (data ?? []) as unknown as StaffShiftRow[];
}

export async function listStaffTimeEntries(
  client: Client,
  from: string,
  to: string,
): Promise<StaffTimeEntryRow[]> {
  const { data, error } = await client
    .from('staff_time_entries')
    .select(TIME_SELECT)
    .gte('clocked_in_at', from)
    .lt('clocked_in_at', to)
    .order('clocked_in_at');
  if (error) throw error;
  return (data ?? []) as unknown as StaffTimeEntryRow[];
}

export async function listStaffTimeOffRequests(
  client: Client,
  from: string,
  to: string,
): Promise<StaffTimeOffRequestRow[]> {
  const { data, error } = await client
    .from('staff_time_off_requests')
    .select(TIME_OFF_SELECT)
    .lte('starts_on', to)
    .gte('ends_on', from)
    .order('starts_on');
  if (error) throw error;
  return (data ?? []) as unknown as StaffTimeOffRequestRow[];
}

export async function clockIn(client: Client, classroomId?: string | null): Promise<string> {
  const { data, error } = await client.rpc('clock_in', { p_classroom_id: classroomId ?? null });
  if (error) throw error;
  return data;
}

export async function clockOut(client: Client, breakMinutes = 0): Promise<string> {
  const { data, error } = await client.rpc('clock_out', { p_break_minutes: breakMinutes });
  if (error) throw error;
  return data;
}
