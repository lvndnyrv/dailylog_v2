import {
  getMyDaycare,
  getMyNotificationDeliverySettings,
  getMyProfile,
  listMyNotificationPreferences,
  listMyNotifications,
  listMyDaycareLocations,
} from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { redirect } from "next/navigation";
import { NotificationCenterProvider } from "@/components/notifications/notification-center";
import { Sidebar } from "@/components/shell/sidebar";
import { getServerSupabase } from "@/lib/supabase/server";

// Sidebar count badges (design 20a/9a): Billing = overdue invoices,
// Compliance = certs expired/expiring within 60 days. One RPC round trip.
async function getNavBadges(supabase: Awaited<ReturnType<typeof getServerSupabase>>) {
  const { data } = await supabase.rpc("get_nav_badges");
  const badges = data?.[0];
  return {
    "/billing": Number(badges?.overdue_invoices ?? 0),
    "/compliance": Number(badges?.cert_issues ?? 0),
  };
}

// Admin shell (Module B): every console section lives under this layout —
// 214px sidebar + per-page header on the #F4F8FD canvas. Admins only.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/");
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const profile = await getMyProfile(supabase);
  if (!isAdminRole(profile?.role)) redirect("/use-the-app");
  if (!profile) redirect("/sign-in");

  const [daycare, locations, badges, notifications, notificationPreferences, deliverySettings, assurance] = await Promise.all([
    getMyDaycare(supabase),
    listMyDaycareLocations(supabase).catch(() => []),
    getNavBadges(supabase),
    listMyNotifications(supabase),
    // Keep the shell usable during rolling deploys where the web bundle lands
    // a moment before the Group 15 migration reaches PostgREST.
    listMyNotificationPreferences(supabase).catch(() => []),
    getMyNotificationDeliverySettings(supabase).catch(() => null),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const hasVerifiedFactor = user.factors?.some((factor) => factor.status === "verified") ?? false;
  const assuranceLevel = assurance.data?.currentLevel ?? "aal1";
  if (hasVerifiedFactor && assuranceLevel !== "aal2") {
    redirect("/two-step?next=/dashboard");
  }
  if (daycare?.require_admin_mfa && !hasVerifiedFactor) {
    redirect("/two-step?mode=setup&required=1&next=/dashboard");
  }

  return (
    <NotificationCenterProvider
      profileId={profile.id}
      initialNotifications={notifications}
      initialPreferences={notificationPreferences}
      initialDeliverySettings={deliverySettings}
    >
      <div className="flex min-h-dvh bg-canvas">
        <Sidebar
          daycareName={locations.find((location) => location.is_active)?.group_name ?? daycare?.name ?? "Your center"}
          locations={locations}
          profile={{
            full_name: profile.full_name,
            display_name: profile.display_name,
            email: profile.email,
            role: profile.role,
            phone: profile.phone,
            avatar_url: profile.avatar_url,
            mfa_enabled: hasVerifiedFactor,
          }}
          badges={badges}
        />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </NotificationCenterProvider>
  );
}
