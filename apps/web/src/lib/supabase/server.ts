import { createServerSupabase } from "@dailylog/db/server";
import { cookies, headers } from "next/headers";
import { authCookieOptions, SESSION_ONLY_COOKIE } from "@/lib/auth/session-cookie";

export async function getServerSupabase() {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const sessionOnly = cookieStore.get(SESSION_ONLY_COOKIE)?.value === "1";
  // Auth sessions created by server actions otherwise record supabase-js-node
  // instead of the browser that actually signed in.
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 512);

  return createServerSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, authCookieOptions(options ?? {}, sessionOnly));
          }
        } catch {
          // Server Components may not set cookies; session refresh happens in
          // proxy.ts (Phase 1).
        }
      },
    },
    userAgent,
  );
}
