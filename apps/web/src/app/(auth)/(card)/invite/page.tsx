import { getStaffInvite } from "@dailylog/db/queries";
import { BrandMark } from "@/components/brand";
import { getServerSupabase } from "@/lib/supabase/server";
import { InviteForm } from "./invite-form";

// Screen 10d — accept a staff invite (arrives from the 4f email link).
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  const invalid = (
    <>
      <h1 className="text-[19px] font-extrabold text-ink">This invite isn&apos;t valid</h1>
      <p className="text-[12.5px] leading-normal text-muted">
        Invites expire after 7 days and work once. Ask your center&apos;s admin to
        send a fresh one.
      </p>
      <a
        href="/sign-in"
        className="rounded-btn bg-primary px-4 py-3.5 text-center text-[15px] font-bold text-white hover:bg-primary-hover"
      >
        Go to sign in
      </a>
    </>
  );

  if (!code || !process.env.NEXT_PUBLIC_SUPABASE_URL) return invalid;

  const supabase = await getServerSupabase();
  const invite = await getStaffInvite(supabase, code).catch(() => null);
  if (!invite) return invalid;

  const roleLabel = invite.role === "educator" ? "an educator" : "a delegated admin";

  return (
    <>
      <div className="flex items-center gap-2.5">
        <BrandMark size="sm" />
      </div>
      <div>
        <h1 className="text-[17px] font-extrabold text-ink">
          You&apos;re invited to {invite.daycare_name}
        </h1>
        <p className="text-[11.5px] text-muted">
          {invite.invited_by_name ?? "Your center"} added you as {roleLabel}
        </p>
      </div>

      <dl className="flex flex-col gap-[5px] rounded-[13px] bg-canvas px-[15px] py-3">
        <div className="flex justify-between text-[12.5px]">
          <dt className="text-muted">Signing in as</dt>
          <dd className="font-bold text-ink">{invite.email}</dd>
        </div>
        {invite.classroom_name && (
          <div className="flex justify-between text-[12.5px]">
            <dt className="text-muted">Room</dt>
            <dd className="font-bold text-ink">{invite.classroom_name}</dd>
          </div>
        )}
        {invite.expires_at && (
          <div className="flex justify-between text-[12.5px]">
            <dt className="text-muted">Invite expires</dt>
            <dd className="font-bold text-ink">
              {new Date(invite.expires_at).toLocaleDateString("en-CA", {
                month: "short",
                day: "numeric",
              })}
            </dd>
          </div>
        )}
      </dl>

      <InviteForm code={code} email={invite.email} />

      <p className="text-center text-[11.5px] leading-normal text-faint">
        Invites expire after 7 days. Two-step sign-in arrives in a later phase.
      </p>
    </>
  );
}
