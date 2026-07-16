import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types.gen';

// Browser (client component) Supabase client. Reads the shared session cookie
// written by the middleware/server client.
export function createBrowserSupabase(url: string, anonKey: string) {
  return createBrowserClient<Database>(url, anonKey);
}

export type BrowserSupabase = ReturnType<typeof createBrowserSupabase>;
