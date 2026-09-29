import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type OutboxRow = {
  id: string;
  recipient_id: string | null;
  recipient_email: string | null;
  channel: 'push' | 'email';
  kind: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
};

type ExpoTicket = { status?: string; details?: { error?: string } };
type TranslationCopy = { title: string; body: string };

const jsonHeaders = { 'content-type': 'application/json' };

class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseTranslationPayload(payload: Record<string, unknown>): TranslationCopy {
  const title = nonEmptyString(payload.title ?? payload.translatedTitle);
  const body = nonEmptyString(payload.body ?? payload.translatedBody);
  if (!title || !body || title.length > 180 || body.length > 5000) {
    throw new Error('Translation provider returned invalid title or body');
  }
  return { title, body };
}

async function translateWithWebhook(
  webhookUrl: string,
  announcementId: string,
  languageCode: string,
  source: TranslationCopy,
): Promise<TranslationCopy> {
  const bearer = Deno.env.get('TRANSLATION_WEBHOOK_BEARER_TOKEN');
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({
      idempotencyKey: `${announcementId}:${languageCode}`,
      sourceLanguage: 'en',
      targetLanguage: languageCode,
      title: source.title,
      body: source.body,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Translation webhook HTTP ${response.status}: ${responseBody.slice(0, 500)}`);
  }
  try {
    return parseTranslationPayload(JSON.parse(responseBody) as Record<string, unknown>);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Translation webhook returned invalid JSON');
    throw error;
  }
}

async function translateWithOpenAI(
  apiKey: string,
  languageCode: string,
  source: TranslationCopy,
): Promise<TranslationCopy> {
  const languageNames: Record<string, string> = {
    fr: 'French', es: 'Spanish', pt: 'Portuguese', ar: 'Arabic',
    zh: 'Simplified Chinese', pa: 'Punjabi', ur: 'Urdu', tl: 'Tagalog',
  };
  const targetLanguage = languageNames[languageCode];
  if (!targetLanguage) throw new Error(`Unsupported target language: ${languageCode}`);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: Deno.env.get('OPENAI_TRANSLATION_MODEL') || 'gpt-6-luna',
      store: false,
      reasoning: { effort: 'none' },
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: `Translate childcare-center announcements from English to ${targetLanguage}. Preserve names, dates, times, URLs, safety instructions, and formatting. Do not add, remove, summarize, or explain any content.`,
          }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify(source) }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'announcement_translation',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
            },
            required: ['title', 'body'],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: 1200,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI translation HTTP ${response.status}: ${responseBody.slice(0, 500)}`);
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(responseBody) as Record<string, unknown>;
  } catch {
    throw new Error('OpenAI translation returned invalid JSON');
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  const outputText = output
    .flatMap((item) => (
      item && typeof item === 'object' && Array.isArray((item as { content?: unknown[] }).content)
        ? (item as { content: unknown[] }).content
        : []
    ))
    .find((content) => (
      content && typeof content === 'object'
      && (content as { type?: unknown }).type === 'output_text'
    ));
  const text = outputText && typeof outputText === 'object'
    ? nonEmptyString((outputText as { text?: unknown }).text)
    : null;
  if (!text) throw new Error('OpenAI translation returned no output text');
  try {
    return parseTranslationPayload(JSON.parse(text) as Record<string, unknown>);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('OpenAI translation output was not valid JSON');
    throw error;
  }
}

async function fetchAnnouncementTranslation(
  supabase: ReturnType<typeof createClient>,
  announcementId: string,
  languageCode: string,
): Promise<TranslationCopy | null> {
  const { data: existing, error: existingError } = await supabase
    .from('announcement_translations')
    .select('title,body')
    .eq('announcement_id', announcementId)
    .eq('language_code', languageCode)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.title && existing?.body) return existing as TranslationCopy;

  const { data: announcement, error: announcementError } = await supabase
    .from('announcements')
    .select('title,body')
    .eq('id', announcementId)
    .single();
  if (announcementError) throw announcementError;
  const source = { title: announcement.title, body: announcement.body };
  const webhookUrl = Deno.env.get('TRANSLATION_WEBHOOK_URL');
  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  const translation = webhookUrl
    ? await translateWithWebhook(webhookUrl, announcementId, languageCode, source)
    : openAiKey
      ? await translateWithOpenAI(openAiKey, languageCode, source)
      : null;
  if (!translation) return null;
  const { error: saveError } = await supabase
    .from('announcement_translations')
    .upsert({
      announcement_id: announcementId,
      language_code: languageCode,
      title: translation.title,
      body: translation.body,
      provider: webhookUrl ? 'webhook' : `openai:${Deno.env.get('OPENAI_TRANSLATION_MODEL') || 'gpt-6-luna'}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'announcement_id,language_code' });
  if (saveError) throw saveError;
  return translation;
}

async function localizeAnnouncementDelivery(
  supabase: ReturnType<typeof createClient>,
  row: OutboxRow,
  cache: Map<string, Promise<TranslationCopy | null>>,
): Promise<OutboxRow> {
  const announcementId = nonEmptyString(row.payload?.announcementId);
  if (row.kind !== 'announcement' || !row.recipient_id || !announcementId) return row;

  const { data: recipient, error } = await supabase
    .from('profiles')
    .select('role,preferred_language')
    .eq('id', row.recipient_id)
    .single();
  if (error) throw error;
  const languageCode = recipient?.role === 'parent'
    ? nonEmptyString(recipient.preferred_language) ?? 'en'
    : 'en';
  if (languageCode === 'en') return row;

  const cacheKey = `${announcementId}:${languageCode}`;
  let pending = cache.get(cacheKey);
  if (!pending) {
    pending = fetchAnnouncementTranslation(supabase, announcementId, languageCode);
    cache.set(cacheKey, pending);
  }
  try {
    const translated = await pending;
    if (!translated) return row;
    return {
      ...row,
      title: `📢 ${translated.title}`,
      body: translated.body,
      payload: { ...row.payload, languageCode, translated: true },
    };
  } catch (translationError) {
    // Translation is an enhancement, never a reason to suppress an urgent
    // center message. Delivery continues with the source copy and the durable
    // outbox retains the provider error in function logs for operations.
    console.warn(`Translation fallback for ${cacheKey}: ${errorMessage(translationError)}`);
    return row;
  }
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
    // Always include the durable outbox kind. Older producers did not repeat
    // it inside payload, which left notification taps with no route even
    // though the push itself arrived successfully.
    data: { kind: row.kind, ...row.payload },
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

  const deliveredTokenIds = tickets.flatMap((ticket, index) =>
    ticket?.status === 'ok' ? [pushTokens[index]?.id] : []
  ).filter((id: string | undefined): id is string => Boolean(id));
  if (deliveredTokenIds.length) {
    await supabase
      .from('push_tokens')
      .update({ last_delivered_at: new Date().toISOString() })
      .in('id', deliveredTokenIds);
  }

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
  const webhookUrl = Deno.env.get('EMAIL_WEBHOOK_URL');
  if (!webhookUrl) {
    throw new PermanentDeliveryError(
      'Email delivery is not configured: set EMAIL_WEBHOOK_URL before enabling email notifications',
    );
  }
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
    // Reminder materialization and waitlist expiry run as database-native Cron
    // jobs. Keeping this worker focused on the durable outbox prevents a slow
    // maintenance query from starving time-sensitive push delivery.
    const { data: rows, error } = await supabase.rpc('claim_notification_batch', { p_limit: 50 });
    if (error) throw error;
    const translationCache = new Map<string, Promise<TranslationCopy | null>>();

    const results = await Promise.allSettled((rows as OutboxRow[]).map(async (row) => {
      try {
        const deliveryRow = await localizeAnnouncementDelivery(supabase, row, translationCache);
        const result = deliveryRow.channel === 'push'
          ? await deliverPush(supabase, deliveryRow)
          : await deliverEmail(supabase, deliveryRow);
        const { error: completeError } = await supabase.rpc('complete_notification_delivery', {
          p_id: row.id,
          p_succeeded: true,
          p_provider_response: result.response,
          p_permanent: result.permanent,
        });
        if (completeError) throw completeError;
      } catch (deliveryError) {
        const message = errorMessage(deliveryError);
        await supabase.rpc('complete_notification_delivery', {
          p_id: row.id,
          p_succeeded: false,
          p_error: message,
          p_permanent: deliveryError instanceof PermanentDeliveryError,
          p_retry_after_seconds: 60,
        });
        throw deliveryError;
      }
    }));

    const failed = results.filter((result) => result.status === 'rejected').length;
    return new Response(JSON.stringify({
      claimed: results.length,
      delivered: results.length - failed,
      failed,
    }), {
      status: failed ? 207 : 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    const message = errorMessage(error);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: jsonHeaders });
  }
});
