import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';
import type { TablesInsert, TablesUpdate } from '../types';

type Client = SupabaseClient<Database>;

export type RoomLiveStatus =
  Database['public']['Functions']['get_rooms_live_status']['Returns'][number];

export type RoomTransition =
  Database['public']['Functions']['get_room_transitions']['Returns'][number];

// Live per-room counts (7a): enrolled, present now, assigned educators.
export async function listRoomsLive(client: Client): Promise<RoomLiveStatus[]> {
  const { data, error } = await client.rpc('get_rooms_live_status');
  if (error) throw error;
  return data ?? [];
}

// Children close to aging out of their band, with the suggested next room (7e).
export async function listRoomTransitions(
  client: Client,
  horizonMonths = 2,
): Promise<RoomTransition[]> {
  const { data, error } = await client.rpc('get_room_transitions', {
    p_horizon_months: horizonMonths,
  });
  if (error) throw error;
  return data ?? [];
}

// Educators not assigned to any room — the floater pool (7a/7c).
export async function listFloaters(client: Client) {
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'educator')
    .is('classroom_id', null)
    .is('archived_at', null)
    .order('full_name');
  if (error) throw error;
  return data ?? [];
}

// Today's roster for one room (7b): child + attendance state.
export async function getRoomRoster(client: Client, roomId: string) {
  const { data, error } = await client
    .from('children')
    .select(
      `id, first_name, last_name, date_of_birth, allergies,
       attendance:attendance_records(id, date, checked_in_at, checked_out_at, status, absence_reason)`,
    )
    .eq('classroom_id', roomId)
    .eq('attendance.date', new Date().toISOString().slice(0, 10))
    .is('archived_at', null)
    .order('first_name');
  if (error) throw error;
  return data ?? [];
}

export async function createRoom(
  client: Client,
  values: TablesInsert<'classrooms'>,
): Promise<string> {
  const { data, error } = await client
    .from('classrooms')
    .insert(values)
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateRoom(
  client: Client,
  roomId: string,
  values: TablesUpdate<'classrooms'>,
): Promise<void> {
  const { error } = await client.from('classrooms').update(values).eq('id', roomId);
  if (error) throw error;
}

// 7c: sending a floater (or any educator) to a room — updates the primary
// assignment and the junction used by RLS write checks.
export async function assignEducatorToRoom(
  client: Client,
  educatorId: string,
  roomId: string,
): Promise<void> {
  const { error: profileError } = await client
    .from('profiles')
    .update({ classroom_id: roomId })
    .eq('id', educatorId);
  if (profileError) throw profileError;

  const { error: junctionError } = await client
    .from('educator_classrooms')
    .upsert({ educator_id: educatorId, classroom_id: roomId });
  if (junctionError) throw junctionError;
}
