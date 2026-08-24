import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types.gen';

type Client = SupabaseClient<Database>;

export type NotificationRow = Database['public']['Tables']['notifications']['Row'];
export type NotificationPreferenceRow =
  Database['public']['Tables']['notification_preferences']['Row'];
export type NotificationDeliverySettingsRow =
  Database['public']['Tables']['notification_delivery_settings']['Row'];

export async function listMyNotifications(
  client: Client,
  limit = 100,
): Promise<NotificationRow[]> {
  const { data, error } = await client
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw error;
  return data ?? [];
}

export async function listMyNotificationPreferences(
  client: Client,
): Promise<NotificationPreferenceRow[]> {
  const { data, error } = await client
    .from('notification_preferences')
    .select('*')
    .order('kind');
  if (error) throw error;
  return data ?? [];
}

export async function getMyNotificationDeliverySettings(
  client: Client,
): Promise<NotificationDeliverySettingsRow | null> {
  const { data, error } = await client
    .from('notification_delivery_settings')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function markNotificationRead(client: Client, notificationId: string) {
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function markAllNotificationsRead(client: Client) {
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

export async function saveNotificationPreferences(
  client: Client,
  values: Array<
    Pick<
      NotificationPreferenceRow,
      'profile_id' | 'daycare_id' | 'kind' | 'in_app' | 'push' | 'email'
    >
  >,
) {
  const { data, error } = await client
    .from('notification_preferences')
    .upsert(values, { onConflict: 'profile_id,kind' })
    .select('*');
  if (error) throw error;
  return data ?? [];
}

export async function saveNotificationDeliverySettings(
  client: Client,
  values: Database['public']['Tables']['notification_delivery_settings']['Insert'],
) {
  const { data, error } = await client
    .from('notification_delivery_settings')
    .upsert(values, { onConflict: 'profile_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

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
    ...(values.body != null ? { p_body: values.body } : {}),
    p_payload: values.payload ?? {},
    ...(values.dedupeKey != null ? { p_dedupe_key: values.dedupeKey } : {}),
  });
  if (error) throw error;
  return data;
}
