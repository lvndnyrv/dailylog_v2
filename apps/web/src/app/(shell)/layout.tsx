import {
  getBillingSummary,
  getMyDaycare,
  getMyProfile,
  listStaff,
} from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { getServerSupabase } from "@/lib/supabase/server";

// Sidebar count badges (design 20a/9a): Billing = overdue invoices,
// Compliance = certs expired or expiring within 60 days.
async function getNavBadges(supabase: Awaited<ReturnType<typeof getServerSupabase>>) {
  const [billing, staff] = await Promise.all([
    getBillingSummary(supabase).catch(() => null),
    listStaff(supabase).catch(() => []),
  ]);

  const soon = Date.now() + 60 * 86400000;
  const certIssues = staff.filter((member) =>
    (member.certifications ?? []).some(
      (cert) => cert.expires_on && new Date(`${cert.expires_on}T12:00`).getTime() <= soon,
    ),
  ).length;

  return {
    "/billing": Number(billing?.overdue_count ?? 0),
    "/compliance": certIssues,
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
