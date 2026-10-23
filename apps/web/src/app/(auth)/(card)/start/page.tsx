import { getMyProfile } from "@dailylog/db/queries";
import { redirect } from "next/navigation";
import { roleDestination } from "@/lib/auth/redirect";
import { getServerSupabase } from "@/lib/supabase/server";
import { StartForm } from "./start-form";

// Screen 10e — approved center signup. Registration uses the same platform-
// issued, email-bound code as mobile so neither surface can self-promote a
// random account to owner admin.
export default async function StartPage() {
  let signedInEmail: string | undefined;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const profile = await getMyProfile(supabase);
      if (profile?.daycare_id) redirect(roleDestination(profile.role));
      signedInEmail = user.email;
    }
  }
  return (
    <>
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">{signedInEmail ? "Finish your center setup" : "Start your center"}</h1>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          {signedInEmail
            ? "Your account is ready. Complete the center details with the registration code issued for this email."
            : "Set up the center DailyLog approved for your administrator email."}
        </p>
      </div>
      <StartForm signedInEmail={signedInEmail} />
      <p className="text-center text-[11.5px] leading-normal text-faint">
        Rooms, staff and families come next, from inside the console. Already
        set up?{" "}
        <a href="/sign-in" className="font-bold text-primary hover:text-primary-hover">
          Sign in
        </a>
        .
      </p>
    </>
  );
}
