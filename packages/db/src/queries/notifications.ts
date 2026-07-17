import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types.gen';

type Client = SupabaseClient<Database>;

export async function enqueueEmailNotification(
  client: Client,
  values: {
    daycareId: string;
    recipientEmail: string;
    kind: string;
    title: string;
    body?: string | null;
    payload?: Json;
    dedupeKey?: string | null;
  },
): Promise<string | null> {
  const { data, error } = await client.rpc('enqueue_email_notification', {
    p_daycare_id: values.daycareId,
    p_recipient_email: values.recipientEmail,
    p_kind: values.kind,
    p_title: values.title,
    p_body: values.body ?? null,
    p_payload: values.payload ?? {},
    p_dedupe_key: values.dedupeKey ?? null,
  });
  if (error) throw error;
  return data;
}
