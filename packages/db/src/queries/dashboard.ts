import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export interface RoomActivityNudgeRow {
  id: string;
  classroom_id: string;
  mode: string;
  message: string;
  snoozed_until: string | null;
  response: string | null;
  responded_at: string | null;
  created_at: string;
  responder: { id: string; full_name: string } | null;
}

export async function listRecentRoomActivityNudges(
  client: Client,
): Promise<RoomActivityNudgeRow[]> {
  const { data, error } = await client
    .from('room_activity_nudges')
    .select('id, classroom_id, mode, message, snoozed_until, response, responded_at, created_at, responder:profiles!room_activity_nudges_responded_by_fkey(id, full_name)')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  const seen = new Set<string>();
  return ((data ?? []) as unknown as RoomActivityNudgeRow[]).filter((row) => {
    if (seen.has(row.classroom_id)) return false;
    seen.add(row.classroom_id);
    return true;
  });
}
