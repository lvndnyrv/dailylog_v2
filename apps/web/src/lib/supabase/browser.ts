import type { Database } from "@dailylog/db";
import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import { authCookieOptions, SESSION_ONLY_COOKIE } from "@/lib/auth/session-cookie";

function readCookies() {
  if (typeof document === "undefined") return [];
  return document.cookie.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return null;
    try {
      return {
        name: decodeURIComponent(part.slice(0, separator).trim()),
        value: decodeURIComponent(part.slice(separator + 1).trim()),
      };
    } catch {
      return null;
    }
  }).filter((cookie): cookie is { name: string; value: string } => cookie !== null);
}

function writeCookie(name: string, value: string, options: CookieOptions) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite === true ? "Strict" : options.sameSite}`);
  if (options.secure || location.protocol === "https:") parts.push("Secure");
  document.cookie = parts.join("; ");
}

export function getBrowserSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: readCookies,
        setAll(cookies) {
          if (typeof document === "undefined") {
            throw new Error("Cannot write authentication cookies during server rendering");
          }
          const sessionOnly = readCookies().some((cookie) => cookie.name === SESSION_ONLY_COOKIE && cookie.value === "1");
          for (const { name, value, options } of cookies) {
            writeCookie(name, value, authCookieOptions(options, sessionOnly));
          }
        },
      },
    },
  );
}
