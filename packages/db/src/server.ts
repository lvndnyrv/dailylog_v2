import { createServerClient } from '@supabase/ssr';
import type { Database } from './types.gen';

// Cookie adapter contract from @supabase/ssr. The web app passes an adapter
// backed by next/headers cookies; this package stays framework-agnostic.
export interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(
    cookies: { name: string; value: string; options?: object }[],
  ): void;
}

export function createServerSupabase(
  url: string,
  anonKey: string,
  cookies: CookieAdapter,
  userAgent?: string,
) {
  return createServerClient<Database>(url, anonKey, {
    cookies,
    ...(userAgent ? { global: { headers: { 'User-Agent': userAgent } } } : {}),
  });
}

export type ServerSupabase = ReturnType<typeof createServerSupabase>;
