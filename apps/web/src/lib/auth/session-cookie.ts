import type { CookieOptions } from "@supabase/ssr";

export const SESSION_ONLY_COOKIE = "dl-session-only";

// Supabase SSR sets a long Max-Age on refreshed auth cookies. Remove that
// lifetime only for non-deletion writes when the user did not ask to be
// remembered. The preference itself is a session cookie.
export function authCookieOptions(options: CookieOptions, sessionOnly: boolean): CookieOptions {
  if (!sessionOnly || options.maxAge === 0) return options;
  const sessionOptions = { ...options };
  delete sessionOptions.maxAge;
  delete sessionOptions.expires;
  return sessionOptions;
}
