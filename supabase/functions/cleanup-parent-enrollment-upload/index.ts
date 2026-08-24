import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = { 'content-type': 'application/json' };

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  try {
    const body = await request.json() as { code?: unknown; path?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const path = typeof body.path === 'string' ? body.path.trim() : '';
    const expectedPrefix = `enrollment-offers/${code}/`;

    if (!code || code.length > 100 || !path.startsWith(expectedPrefix) || path.length > 500) {
      return response({ error: 'Invalid enrollment upload cleanup request' }, 400);
    }

    const admin = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: allowed, error: eligibilityError } = await admin.rpc(
      'can_delete_parent_enrollment_upload',
      { p_storage_path: path },
    );
    if (eligibilityError) throw eligibilityError;
    if (!allowed) return response({ error: 'This upload is still referenced or no longer eligible' }, 409);

    const { data, error } = await admin.storage.from('documents').remove([path]);
    if (error) throw error;
    return response({ deleted: data?.length === 1, path });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload cleanup failed';
    return response({ error: message }, 500);
  }
});
