import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types.gen';

type Client = SupabaseClient<Database>;

export type NotificationRow = Database['public']['Tables']['notifications']['Row'];
export type NotificationPreferenceRow =
  Database['public']['Tables']['notification_preferences']['Row'];
export type NotificationDeliverySettingsRow =
  Database['public']['Tables']['notification_delivery_settings']['Row'];

export type NotificationDeliveryStatus =
  | 'delivered'
  | 'queued'
  | 'retrying'
  | 'processing'
  | 'skipped'
  | 'failed';

export interface NotificationDeliveryHealth {
  windowDays: number;
  counts: Record<NotificationDeliveryStatus | 'total', number>;
  deliveries: Array<{
    id: string;
    title: string;
    kind: string;
    channel: 'push' | 'email';
    status: NotificationDeliveryStatus;
    attempts: number;
    maxAttempts: number;
    createdAt: string;
    deliveredAt: string | null;
    availableAt: string;
    issue: string | null;
    canRetry: boolean;
  }>;
}

export interface PushDeliveryReachability {
  counts: {
    total: number;
    pushReady: number;
    withoutPush: number;
    parentsWithoutPush: number;
    staffWithoutPush: number;
  };
  gaps: Array<{
    profileId: string;
    fullName: string;
    role: string;
    emailPresent: boolean;
    lastSeenAt: string | null;
    lastDeliveredAt: string | null;
  }>;
}

const EMPTY_DELIVERY_HEALTH: NotificationDeliveryHealth = {
  windowDays: 7,
  counts: {
    total: 0,
    delivered: 0,
    queued: 0,
    retrying: 0,
    processing: 0,
    skipped: 0,
    failed: 0,
  },
  deliveries: [],
};

export async function getNotificationDeliveryHealth(
  client: Client,
  days = 7,
): Promise<NotificationDeliveryHealth> {
  const { data, error } = await client.rpc('list_notification_delivery_health', {
    p_days: days,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return EMPTY_DELIVERY_HEALTH;
  }
  return data as unknown as NotificationDeliveryHealth;
}

export async function retryNotificationDelivery(client: Client, deliveryId: string) {
  const { data, error } = await client.rpc('retry_notification_delivery', {
    p_delivery_id: deliveryId,
  });
  if (error) throw error;
  return data;
}

export async function getPushDeliveryReachability(
  client: Client,
): Promise<PushDeliveryReachability> {
  const { data, error } = await client.rpc('get_push_delivery_reachability');
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      counts: {
        total: 0,
        pushReady: 0,
        withoutPush: 0,
        parentsWithoutPush: 0,
        staffWithoutPush: 0,
      },
      gaps: [],
    };
  }
  return data as unknown as PushDeliveryReachability;
}

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
