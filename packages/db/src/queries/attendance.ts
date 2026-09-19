import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';
import type { Tables } from '../types';

type Client = SupabaseClient<Database>;

export interface AttendanceDayRow {
  id: string;
  first_name: string;
  last_name: string;
  classroom: { id: string; name: string } | null;
  attendance: Array<
    Tables<'attendance_records'> & {
      checked_in_by_profile: { id: string; full_name: string } | null;
      checked_out_by_profile: { id: string; full_name: string } | null;
    }
  >;
}

type AttendanceDayCandidate = AttendanceDayRow & {
  setup_state: unknown;
  enrolled_on: string | null;
};

export interface AttendanceCorrectionRow {
  id: string;
  attendance_id: string;
  previous_checked_in_at: string | null;
  previous_checked_out_at: string | null;
  corrected_checked_in_at: string | null;
  corrected_checked_out_at: string | null;
  source: string;
  reason: string;
  corrected_at: string;
  corrected_by_profile: { id: string; full_name: string } | null;
}

export interface AttendanceFollowupRow {
  id: string;
  child_id: string;
  attendance_date: string;
  message: string;
  sent_at: string;
  queued_recipients: number;
  escalation_due_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  sent_by_profile: { id: string; full_name: string } | null;
}

export interface LatePickupEventRow {
  id: string;
  child_id: string;
  occurred_on: string;
  expected_at: string;
  picked_up_at: string;
  late_minutes: number;
  billable_minutes: number;
  fee_cents: number;
  conversation_required: boolean;
  collected_by: string;
  notes: string | null;
  billing_status: string;
  invoice_id: string | null;
  child: { id: string; first_name: string; last_name: string } | null;
  invoice: { id: string; number: string | null } | null;
}

export interface MissingCheckoutRow {
  id: string;
  date: string;
  checked_in_at: string | null;
  child: { id: string; first_name: string; last_name: string } | null;
}

// Every active child with their (0 or 1) attendance record for the day (8a).
export async function listAttendanceDay(
  client: Client,
  date: string,
): Promise<AttendanceDayRow[]> {
  const { data, error } = await client
    .from('children')
    .select(
      `id, first_name, last_name, setup_state, enrolled_on,
       classroom:classrooms(id, name),
       attendance:attendance_records(
         *,
         checked_in_by_profile:profiles!attendance_records_checked_in_by_fkey(id, full_name),
         checked_out_by_profile:profiles!attendance_records_checked_out_by_fkey(id, full_name)
       )`,
    )
    .eq('attendance.date', date)
    .is('archived_at', null)
    .order('first_name');
  if (error) throw error;
  const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][
    new Date(`${date}T12:00:00Z`).getUTCDay()
  ];
  return ((data ?? []) as unknown as AttendanceDayCandidate[])
    .filter((child) => !child.enrolled_on || child.enrolled_on <= date)
    .filter((child) => child.attendance.length > 0 || isExpectedOn(child.setup_state, weekday))
    .map(({ setup_state: _setupState, enrolled_on: _enrolledOn, ...child }) => child);
}

function isExpectedOn(setupState: unknown, weekday: string): boolean {
  if (!setupState || typeof setupState !== 'object' || Array.isArray(setupState)) {
    return !['sat', 'sun'].includes(weekday);
  }
  const weekly = (setupState as Record<string, unknown>).weekly_schedule;
  if (!weekly || typeof weekly !== 'object' || Array.isArray(weekly)) {
    return !['sat', 'sun'].includes(weekday);
  }
  const value = (weekly as Record<string, unknown>)[weekday];
  return value === 'full' || value === 'half';
}

export async function getAttendanceWeek(client: Client) {
  const { data, error } = await client.rpc('get_attendance_week');
  if (error) throw error;
  return data ?? [];
}

export async function listAttendanceCorrections(
  client: Client,
  attendanceIds: string[],
): Promise<AttendanceCorrectionRow[]> {
  if (attendanceIds.length === 0) return [];
  const { data, error } = await client
    .from('attendance_corrections')
    .select(
      `id, attendance_id, previous_checked_in_at, previous_checked_out_at,
       corrected_checked_in_at, corrected_checked_out_at, source, reason, corrected_at,
       corrected_by_profile:profiles!attendance_corrections_corrected_by_fkey(id, full_name)`,
    )
    .in('attendance_id', attendanceIds)
    .order('corrected_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AttendanceCorrectionRow[];
}

export async function listAttendanceFollowups(
  client: Client,
  date: string,
): Promise<AttendanceFollowupRow[]> {
  const { data, error } = await client
    .from('attendance_followups')
    .select(
      `id, child_id, attendance_date, message, sent_at, queued_recipients,
       escalation_due_at, resolved_at, resolution,
       sent_by_profile:profiles!attendance_followups_sent_by_fkey(id, full_name)`,
    )
    .eq('attendance_date', date)
    .order('sent_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AttendanceFollowupRow[];
}

export async function listLatePickupEvents(
  client: Client,
  from: string,
  toExclusive: string,
): Promise<LatePickupEventRow[]> {
  const { data, error } = await client
    .from('late_pickup_events')
    .select(
      `id, child_id, occurred_on, expected_at, picked_up_at, late_minutes,
       billable_minutes, fee_cents, conversation_required, collected_by, notes,
       billing_status, invoice_id,
       child:children(id, first_name, last_name),
       invoice:invoices(id, number)`,
    )
    .gte('occurred_on', from)
    .lt('occurred_on', toExclusive)
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LatePickupEventRow[];
}

export async function listMissingCheckouts(
  client: Client,
  beforeDate: string,
  fromDate: string,
): Promise<MissingCheckoutRow[]> {
  const { data, error } = await client
    .from('attendance_records')
    .select('id, date, checked_in_at, child:children(id, first_name, last_name)')
    .not('checked_in_at', 'is', null)
    .is('checked_out_at', null)
    .lt('date', beforeDate)
    .gte('date', fromDate)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MissingCheckoutRow[];
}

export async function kioskLookupPin(client: Client, pin: string) {
  const { data, error } = await client.rpc('kiosk_lookup_pin', { p_pin: pin });
  if (error) throw error;
  return data ?? [];
}

export async function kioskCheck(
  client: Client,
  childId: string,
  pin: string,
): Promise<'checked_in' | 'checked_out'> {
  const { data, error } = await client.rpc('kiosk_check', {
    p_child_id: childId,
    p_pin: pin,
  });
  if (error) throw error;
  return data as 'checked_in' | 'checked_out';
}
