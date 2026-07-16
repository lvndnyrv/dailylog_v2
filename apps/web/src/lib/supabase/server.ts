import { createServerSupabase } from "@dailylog/db/server";
import { cookies } from "next/headers";

export async function getServerSupabase() {
  const cookieStore = await cookies();

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
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components may not set cookies; session refresh happens in
          // proxy.ts (Phase 1).
        }
      },
    },
  );
}
