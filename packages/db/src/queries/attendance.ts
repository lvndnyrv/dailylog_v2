import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';
import type { Tables } from '../types';

type Client = SupabaseClient<Database>;

export interface AttendanceDayRow {
  id: string;
  first_name: string;
  last_name: string;
  classroom: { id: string; name: string } | null;
  attendance: Tables<'attendance_records'>[];
}

// Every active child with their (0 or 1) attendance record for the day (8a).
export async function listAttendanceDay(
  client: Client,
  date: string,
): Promise<AttendanceDayRow[]> {
  const { data, error } = await client
    .from('children')
    .select(
      `id, first_name, last_name,
       classroom:classrooms(id, name),
       attendance:attendance_records(*)`,
    )
    .eq('attendance.date', date)
    .is('archived_at', null)
    .order('first_name');
  if (error) throw error;
  return (data ?? []) as unknown as AttendanceDayRow[];
}

export async function getAttendanceWeek(client: Client) {
  const { data, error } = await client.rpc('get_attendance_week');
  if (error) throw error;
  return data ?? [];
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
