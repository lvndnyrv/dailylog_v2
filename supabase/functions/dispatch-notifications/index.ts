import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type OutboxRow = {
  id: string;
  recipient_id: string | null;
  recipient_email: string | null;
  channel: 'push' | 'email';
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
};

type ExpoTicket = { status?: string; details?: { error?: string } };

const jsonHeaders = { 'content-type': 'application/json' };

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function deliverPush(
  supabase: ReturnType<typeof createClient>,
  row: OutboxRow,
): Promise<{ response: unknown; permanent: boolean }> {
  if (!row.recipient_id) throw new Error('Push delivery requires a profile recipient');
  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('id,token')
    .eq('user_id', row.recipient_id);
  if (error) throw error;
  const pushTokens = (tokens ?? []) as { id: string; token: string }[];

  // The in-app notification was already persisted. No device token is a
  // terminal push outcome, not a reason to retry the same row forever.
  if (!pushTokens.length) return { response: { skipped: 'no_push_token' }, permanent: false };

  const messages = pushTokens.map(({ token }) => ({
    to: token,
    sound: 'default',
    title: row.title,
    body: row.body ?? undefined,
    data: row.payload,
    priority: row.payload?.priority === 'high' ? 'high' : 'default',
    channelId: typeof row.payload?.channelId === 'string' ? row.payload.channelId : 'default',
  }));
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      accept: 'application/json',
      ...(Deno.env.get('EXPO_ACCESS_TOKEN')
        ? { authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` }
        : {}),
    },
    body: JSON.stringify(messages),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Expo push HTTP ${response.status}: ${JSON.stringify(result)}`);

  const tickets: ExpoTicket[] = Array.isArray(result?.data) ? result.data : [];
  const invalidTokenIds = tickets.flatMap((ticket, index) =>
    ticket?.details?.error === 'DeviceNotRegistered' ? [pushTokens[index]?.id] : []
  ).filter((id: string | undefined): id is string => Boolean(id));
  if (invalidTokenIds.length) await supabase.from('push_tokens').delete().in('id', invalidTokenIds);

  const delivered = tickets.some((ticket) => ticket?.status === 'ok');
  const allPermanent = tickets.length > 0 && tickets.every(
    (ticket) => ticket?.details?.error === 'DeviceNotRegistered',
  );
  if (!delivered && !allPermanent) throw new Error(`Expo rejected push: ${JSON.stringify(result)}`);
  return { response: result, permanent: allPermanent };
}

async function deliverEmail(
  supabase: ReturnType<typeof createClient>,
  row: OutboxRow,
): Promise<{ response: unknown; permanent: boolean }> {
  const webhookUrl = requiredEnv('EMAIL_WEBHOOK_URL');
  let recipient = { email: row.recipient_email, full_name: null as string | null };
  if (!recipient.email && row.recipient_id) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('email,full_name')
      .eq('id', row.recipient_id)
      .single();
    if (error) throw error;
    recipient = profile;
  }
  if (!recipient.email) throw new Error('Email delivery requires a recipient address');

  const bearer = Deno.env.get('EMAIL_WEBHOOK_BEARER_TOKEN');
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { ...jsonHeaders, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({
      to: recipient.email,
      recipientName: recipient.full_name,
      subject: row.title,
      text: row.body ?? '',
      data: row.payload,
      idempotencyKey: row.id,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Email webhook HTTP ${response.status}: ${text}`);
  return { response: { status: response.status, body: text.slice(0, 2000) }, permanent: false };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders });
  }

  try {
    const secret = requiredEnv('NOTIFICATION_WORKER_SECRET');
    if (request.headers.get('x-worker-secret') !== secret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
    }

    const supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: rows, error } = await supabase.rpc('claim_notification_batch', { p_limit: 50 });
    if (error) throw error;

    const results = await Promise.allSettled((rows as OutboxRow[]).map(async (row) => {
      try {
        const result = row.channel === 'push'
          ? await deliverPush(supabase, row)
          : await deliverEmail(supabase, row);
        const { error: completeError } = await supabase.rpc('complete_notification_delivery', {
          p_id: row.id,
          p_succeeded: true,
          p_provider_response: result.response,
          p_permanent: result.permanent,
        });
        if (completeError) throw completeError;
      } catch (deliveryError) {
        const message = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
        await supabase.rpc('complete_notification_delivery', {
          p_id: row.id,
          p_succeeded: false,
          p_error: message,
          p_retry_after_seconds: 60,
        });
        throw deliveryError;
      }
    }));

    const failed = results.filter((result) => result.status === 'rejected').length;
    return new Response(JSON.stringify({ claimed: results.length, delivered: results.length - failed, failed }), {
      status: failed ? 207 : 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: jsonHeaders });
  }
});
