import { getMyProfile } from "@dailylog/db/queries";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { signOutAction } from "@/lib/auth/actions";
import { roleDestination } from "@/lib/auth/redirect";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function AccountIssuePage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const profile = await getMyProfile(supabase);
  if (profile && !profile.archived_at) redirect(roleDestination(profile.role));
  const inactive = Boolean(profile?.archived_at);

  return (
    <>
      <BrandMark size="sm" />
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">
          {inactive ? "Your center access is inactive" : "We couldn't load your profile"}
        </h1>
        <p className="mt-1 text-[12.5px] leading-normal text-muted">
          {inactive
            ? "Your account is preserved, but it no longer has access to this center."
            : <>Your sign-in is valid, but the DailyLog profile connected to {user.email ?? "this account"}{" "}is not ready. This can happen briefly after accepting an invitation.</>}
        </p>
      </div>
      <div className="rounded-xl border border-[#D6E1F0] bg-canvas px-4 py-3 text-[12px] leading-relaxed text-muted">
        {inactive
          ? "Ask your center owner to restore your access if you still work with this center."
          : "Try again in a moment. If the problem continues, ask your center administrator to resend your invitation or contact DailyLog support."}
      </div>
      {!inactive && (
        <Link
          href="/"
          className="rounded-btn bg-primary px-4 py-3.5 text-center text-[15px] font-bold text-white hover:bg-primary-hover"
        >
          Try again
        </Link>
      )}
      <form action={signOutAction}>
        <button
          type="submit"
          className="w-full rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas"
        >
          Sign out
        </button>
      </form>
    </>
  );
}
