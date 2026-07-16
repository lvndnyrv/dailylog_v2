import { getMyProfile } from "@dailylog/db/queries";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { signOutAction } from "@/lib/auth/actions";
import { getServerSupabase } from "@/lib/supabase/server";

// Mobile-app interstitial: educators and parents who sign in on the web land
// here (PHASE_1 Module A — the console is admins-only).
export default async function UseTheAppPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/");
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const profile = await getMyProfile(supabase);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div
        className="flex w-[430px] max-w-full flex-col items-center gap-4 rounded-[22px] border border-[rgba(23,51,91,.12)] bg-card p-7 text-center"
        style={{ boxShadow: "0 14px 40px rgba(23,51,91,.16)" }}
      >
        <BrandMark size="sm" />
        <div>
          <h1 className="text-[19px] font-extrabold text-ink">
            {profile?.full_name ? `Hi ${profile.full_name.split(" ")[0]} — ` : ""}your
            day lives in the app
          </h1>
          <p className="mt-1 text-[12.5px] leading-normal text-muted">
            This console is for center admins. Everything you need — daily logs,
            messages, your room — is in the DailyLog app on your phone.
          </p>
        </div>
        <form action={signOutAction} className="w-full">
          <button
            type="submit"
            className="w-full rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
