import { createBrowserSupabase } from "@dailylog/db/browser";

export function getBrowserSupabase() {
  return createBrowserSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
