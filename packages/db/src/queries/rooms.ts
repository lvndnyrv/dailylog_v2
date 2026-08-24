import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';
import type { Tables, TablesInsert, TablesUpdate } from '../types';

type Client = SupabaseClient<Database>;

type GeneratedRoomLiveStatus =
  Database['public']['Functions']['get_rooms_live_status']['Returns'][number];

export interface RoomEducator {
  id: string;
  full_name: string;
}

function isRoomEducator(value: unknown): value is RoomEducator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const educator = value as Record<string, unknown>;
  return typeof educator.id === 'string' && typeof educator.full_name === 'string';
}

export type RoomLiveStatus = Omit<GeneratedRoomLiveStatus, 'educators'> & {
    educators: RoomEducator[];
    opens_on: string | null;
    nap_start: string | null;
    nap_end: string | null;
    lead_educator_id: string | null;
  };

export type RoomTransition =
  Database['public']['Functions']['get_room_transitions']['Returns'][number];

export interface RoomCoverageAssignmentRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  classroom: { id: string; name: string } | null;
  staff: {
    id: string;
    profile: { id: string; full_name: string; email: string; classroom_id: string | null } | null;
  } | null;
}

export interface RoomTransitionPlanRow {
  id: string;
  child_id: string;
  from_classroom_id: string;
  to_classroom_id: string;
  move_on: string;
  transition_week: boolean;
  transition_starts_on: string | null;
  transition_ends_on: string | null;
  current_tuition_cents: number | null;
  new_tuition_cents: number | null;
  currency: string;
  family_message: string | null;
  family_visible: boolean;
  published_at: string | null;
  status: string;
  notes: string | null;
  child: { id: string; first_name: string; last_name: string } | null;
  from_room: { id: string; name: string } | null;
  to_room: { id: string; name: string } | null;
}

// Live per-room counts (7a): enrolled, present now, assigned educators.
export async function listRoomsLive(client: Client): Promise<RoomLiveStatus[]> {
  const [live, settings] = await Promise.all([
    client.rpc('get_rooms_live_status'),
    client
      .from('classrooms')
      .select('id, opens_on, nap_start, nap_end, lead_educator_id')
      .is('archived_at', null),
  ]);
  if (live.error) throw live.error;
  if (settings.error) throw settings.error;
  const byId = new Map((settings.data ?? []).map((room) => [room.id, room]));
  return (live.data ?? []).map((room): RoomLiveStatus => {
    const educators = Array.isArray(room.educators)
      ? (room.educators as unknown[]).filter(isRoomEducator)
      : [];
    return {
      ...room,
      educators,
      opens_on: byId.get(room.id)?.opens_on ?? null,
      nap_start: byId.get(room.id)?.nap_start ?? null,
      nap_end: byId.get(room.id)?.nap_end ?? null,
      lead_educator_id: byId.get(room.id)?.lead_educator_id ?? null,
    };
  });
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

export async function listRoomCoverageAssignments(
  client: Client,
  from: string,
  to: string,
): Promise<RoomCoverageAssignmentRow[]> {
  const { data, error } = await client
    .from('room_coverage_assignments')
    .select(
      `id, starts_at, ends_at, status, notes,
       classroom:classrooms(id, name),
       staff:staff_members(id, profile:profiles(id, full_name, email, classroom_id))`,
    )
    .lt('starts_at', to)
    .gt('ends_at', from)
    .neq('status', 'cancelled')
    .order('starts_at');
  if (error) throw error;
  return (data ?? []) as unknown as RoomCoverageAssignmentRow[];
}

export async function listRoomTransitionPlans(client: Client): Promise<RoomTransitionPlanRow[]> {
  const { data, error } = await client
    .from('room_transition_plans')
    .select(
      `id, child_id, from_classroom_id, to_classroom_id, move_on, transition_week,
       transition_starts_on, transition_ends_on, current_tuition_cents,
       new_tuition_cents, currency, family_message, family_visible, published_at,
       status, notes, child:children(id, first_name, last_name),
       from_room:classrooms!room_transition_plans_from_classroom_id_fkey(id, name),
       to_room:classrooms!room_transition_plans_to_classroom_id_fkey(id, name)`,
    )
    .eq('status', 'planned')
    .order('move_on');
  if (error) throw error;
  return (data ?? []) as unknown as RoomTransitionPlanRow[];
}

export async function listRoomCombinations(client: Client): Promise<Tables<'room_combinations'>[]> {
  const { data, error } = await client
    .from('room_combinations')
    .select('*')
    .order('period');
  if (error) throw error;
  return data ?? [];
}

// Today's roster for one room (7b): child + attendance state.
export async function getRoomRoster(client: Client, roomId: string, date?: string) {
  const { data, error } = await client
    .from('children')
    .select(
      `id, first_name, last_name, date_of_birth, allergies,
       attendance:attendance_records(id, date, checked_in_at, checked_out_at, status, absence_reason)`,
    )
    .eq('classroom_id', roomId)
    .eq('attendance.date', date ?? new Date().toISOString().slice(0, 10))
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
