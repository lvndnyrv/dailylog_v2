import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export type InboxThread =
  Database['public']['Functions']['get_inbox_threads']['Returns'][number];

export async function listInboxThreads(client: Client): Promise<InboxThread[]> {
  const { data, error } = await client.rpc('get_inbox_threads');
  if (error) throw error;
  return data ?? [];
}

export interface ThreadMessage {
  id: string;
  body: string;
  created_at: string | null;
  read_at: string | null;
  sender: { id: string; full_name: string; role: string } | null;
}

export async function getThreadMessages(
  client: Client,
  conversationId: string,
): Promise<ThreadMessage[]> {
  const { data, error } = await client
    .from('messages')
    .select('id, body, created_at, read_at, sender:profiles(id, full_name, role)')
    .eq('conversation_id', conversationId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as unknown as ThreadMessage[];
}

// Reply as staff; reading the thread marks the parent's messages read.
export async function sendThreadMessage(
  client: Client,
  conversationId: string,
  childId: string,
  daycareId: string,
  senderId: string,
  body: string,
): Promise<void> {
  const { error } = await client.from('messages').insert({
    daycare_id: daycareId,
    conversation_id: conversationId,
    child_id: childId,
    sender_id: senderId,
    body,
  });
  if (error) throw error;
}

export async function markThreadRead(client: Client, childId: string): Promise<void> {
  const { error } = await client.rpc('mark_messages_read', { p_child_id: childId });
  if (error) throw error;
}

// ── Broadcasts (5b/5c) — announcements the parent app already renders ───────

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  pinned: boolean | null;
  rsvp_enabled: boolean;
  event_at: string | null;
  created_at: string | null;
  classroom: { id: string; name: string } | null;
  author: { full_name: string } | null;
  rsvps: { response: string }[];
}

export async function listBroadcasts(client: Client, limit = 12): Promise<Broadcast[]> {
  const { data, error } = await client
    .from('announcements')
    .select(
      `id, title, body, pinned, rsvp_enabled, event_at, created_at,
       classroom:classrooms(id, name),
       author:profiles(full_name),
       rsvps:announcement_rsvps(response)`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as Broadcast[];
}

export async function createBroadcast(
  client: Client,
  values: {
    daycare_id: string;
    author_id: string;
    title: string;
    body: string;
    classroom_id?: string | null;
    pinned?: boolean;
    rsvp_enabled?: boolean;
    event_at?: string | null;
  },
): Promise<void> {
  const { error } = await client.from('announcements').insert(values);
  if (error) throw error;
}
