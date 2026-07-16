import { getMyProfile } from "@dailylog/db/queries";
import { redirect } from "next/navigation";
import { roleDestination } from "@/lib/auth/redirect";
import { getServerSupabase } from "@/lib/supabase/server";

// Root: route by session + role. (The Phase 0 children listing moved behind
// auth; the roster proper is Module C's /children.)
export default async function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <main className="p-10 font-sans">
        <h1 className="text-2xl font-extrabold text-ink">DailyLog Admin</h1>
        <p className="mt-4 max-w-lg">
          No Supabase configured. Copy <code className="font-mono">.env.example</code> to{" "}
          <code className="font-mono">.env.local</code> with your project&apos;s URL and
          anon key, then reload.
        </p>
      </main>
    );
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const profile = await getMyProfile(supabase);
  redirect(roleDestination(profile?.role));
}
