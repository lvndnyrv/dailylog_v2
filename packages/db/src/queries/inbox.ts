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
    .select('id, body, created_at, read_at, sender:profiles!messages_sender_id_fkey(id, full_name, role)')
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

// ── Private staff conversations ─────────────────────────────────────────────

export type StaffConversationSummary =
  Database['public']['Functions']['list_my_staff_conversations']['Returns'][number];

export async function getOrCreateStaffConversation(
  client: Client,
  otherProfileId: string,
): Promise<string> {
  const { data, error } = await client.rpc('get_or_create_staff_conversation', {
    p_other_profile_id: otherProfileId,
  });
  if (error) throw error;
  return data;
}

export async function listMyStaffConversations(
  client: Client,
): Promise<StaffConversationSummary[]> {
  const { data, error } = await client.rpc('list_my_staff_conversations');
  if (error) throw error;
  return data ?? [];
}

export async function markStaffConversationRead(
  client: Client,
  conversationId: string,
): Promise<number> {
  const { data, error } = await client.rpc('mark_staff_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return data;
}

export async function sendStaffMessage(
  client: Client,
  conversationId: string,
  body: string,
): Promise<string> {
  const { data, error } = await client.rpc('send_staff_message', {
    p_conversation_id: conversationId,
    p_body: body,
  });
  if (error) throw error;
  return data;
}

// ── Broadcasts (5b/5c) — announcements the parent app already renders ───────

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  pinned: boolean | null;
  scheduled_for: string | null;
  published_at: string | null;
  cancelled_at: string | null;
  rsvp_enabled: boolean;
  event_at: string | null;
  event_ends_at: string | null;
  event_location: string | null;
  created_at: string | null;
  classroom: { id: string; name: string } | null;
  author: { full_name: string } | null;
  rsvps: { response: string }[];
  recipient_count: number;
  read_count: number;
  push_queued: number;
  push_delivered: number;
}

export async function listBroadcasts(client: Client, limit = 12): Promise<Broadcast[]> {
  const { data, error } = await client
    .from('announcements')
    .select(
      `id, title, body, pinned, scheduled_for, published_at, cancelled_at,
       rsvp_enabled, event_at, event_ends_at, event_location, created_at,
       classroom:classrooms(id, name),
       author:profiles!announcements_author_id_fkey(full_name),
       rsvps:announcement_rsvps(response)`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: metrics, error: metricsError } = await client.rpc(
    'list_broadcast_delivery_metrics',
    { p_announcement_ids: rows.map((row) => row.id) },
  );
  if (metricsError) throw metricsError;
  const byId = new Map((metrics ?? []).map((metric) => [metric.announcement_id, metric]));
  return rows.map((row) => {
    const metric = byId.get(row.id);
    return {
      ...row,
      recipient_count: Number(metric?.recipient_count ?? 0),
      read_count: Number(metric?.read_count ?? 0),
      push_queued: Number(metric?.push_queued ?? 0),
      push_delivered: Number(metric?.push_delivered ?? 0),
    };
  }) as unknown as Broadcast[];
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
    scheduled_for?: string | null;
    published_at?: string | null;
    rsvp_enabled?: boolean;
    event_at?: string | null;
    event_ends_at?: string | null;
    event_location?: string | null;
  },
): Promise<void> {
  const { error } = await client.from('announcements').insert(values);
  if (error) throw error;
}

export async function updateScheduledBroadcast(
  client: Client,
  id: string,
  values: Database['public']['Tables']['announcements']['Update'],
): Promise<void> {
  const { error } = await client
    .from('announcements')
    .update(values)
    .eq('id', id)
    .is('published_at', null)
    .is('cancelled_at', null)
    .select('id')
    .single();
  if (error) throw error;
}
