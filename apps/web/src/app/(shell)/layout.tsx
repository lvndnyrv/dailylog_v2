import { getMyDaycare, getMyProfile } from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { redirect } from "next/navigation";
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

  const [daycare, badges] = await Promise.all([
    getMyDaycare(supabase),
    getNavBadges(supabase),
  ]);

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar
        daycareName={daycare?.name ?? "Your center"}
        profile={{
          full_name: profile.full_name,
          email: profile.email,
          role: profile.role,
        }}
        badges={badges}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
