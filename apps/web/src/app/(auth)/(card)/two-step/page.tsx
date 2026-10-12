import { getMyDaycare, getMyProfile } from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { TwoStepSecurity } from "@/components/auth/two-step-security";
import { getServerSupabase } from "@/lib/supabase/server";

function safeDestination(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export default async function TwoStepPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string; required?: string }>;
}) {
  const params = await searchParams;
  const destination = safeDestination(params.next);
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(destination)}`);

  const [profile, daycare, factorResult, assuranceResult] = await Promise.all([
    getMyProfile(supabase),
    getMyDaycare(supabase),
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (!profile || !isAdminRole(profile.role)) redirect("/use-the-app");

  const factors = factorResult.data?.totp ?? [];
  const currentLevel = assuranceResult.data?.currentLevel ?? "aal1";
  const requestedMode = params.mode;
  const mode = requestedMode === "manage" || requestedMode === "setup"
    ? requestedMode
    : "challenge";

  if (mode === "challenge" && currentLevel === "aal2") redirect(destination);
  if (mode === "challenge" && factors.length === 0) {
    const required = daycare?.require_admin_mfa || params.required === "1";
    redirect(`/two-step?mode=setup&next=${encodeURIComponent(destination)}${required ? "&required=1" : ""}`);
  }
  if (mode === "manage" && factors.length > 0 && currentLevel !== "aal2") {
    redirect(`/two-step?next=${encodeURIComponent("/two-step?mode=manage")}`);
  }

  return (
    <>
      <BrandMark />
      <TwoStepSecurity
        mode={mode}
        destination={destination}
        factors={factors.map((factor) => ({
          id: factor.id,
          friendlyName: factor.friendly_name ?? "Authenticator app",
          createdAt: factor.created_at,
          lastChallengedAt: factor.last_challenged_at ?? null,
        }))}
        required={Boolean(daycare?.require_admin_mfa || params.required === "1")}
      />
    </>
  );
}
