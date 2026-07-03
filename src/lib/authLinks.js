import { supabase } from './supabase';

/**
 * Completes Supabase auth flows arriving via deep link
 * (magic-link parent invites, password recovery emails).
 *
 * Handles both flows:
 *  - PKCE:      dailylog://auth?code=...
 *  - Implicit:  dailylog://auth#access_token=...&refresh_token=...
 *
 * Returns true if a session was established.
 */
export async function handleAuthUrl(url) {
  if (!url || typeof url !== 'string') return false;

  try {
    // PKCE flow: ?code=
    const codeMatch = url.match(/[?&]code=([^&#]+)/);
    if (codeMatch) {
      const { error } = await supabase.auth.exchangeCodeForSession(codeMatch[1]);
      if (error) console.warn('Auth code exchange failed:', error.message);
      return !error;
    }

    // Implicit flow: tokens in the URL fragment
    const fragment = url.split('#')[1];
    if (!fragment) return false;

    const params = {};
    for (const pair of fragment.split('&')) {
      const [key, value] = pair.split('=');
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }

    if (params.error_description) {
      console.warn('Auth link error:', params.error_description);
      return false;
    }

    if (params.access_token && params.refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });
      if (error) console.warn('Auth setSession failed:', error.message);
      return !error;
    }
  } catch (err) {
    console.warn('Auth link handling error:', err.message);
  }
  return false;
}

