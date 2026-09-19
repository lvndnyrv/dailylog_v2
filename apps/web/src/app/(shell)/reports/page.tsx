import {
  getMyProfile,
  hasPermission,
  listRecentReportExports,
  listReportAdmins,
  listReportSchedules,
} from "@dailylog/db/queries";
import { ReportsView } from "@/components/reports/reports-view";
import { SectionHeader } from "@/components/shell/header";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function ReportsPage() {
  const client = await getServerSupabase();
  const profile = await getMyProfile(client);
  const canView = await hasPermission(client, "reports", "view");
  if (!profile?.daycare_id || !["owner_admin", "admin"].includes(profile.role) || !canView) {
    return (
      <>
        <SectionHeader title="Reports" subtitle="Center reporting and exports" showUtilities={false} />
        <main className="flex flex-1 items-start p-7">
          <div className="max-w-xl rounded-2xl border border-hairline bg-card p-6">
            <h2 className="text-lg font-extrabold text-ink">Reports access is restricted</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Ask an owner administrator to enable Reports viewing for your role.
            </p>
          </div>
        </main>
      </>
    );
  }
  const [schedules, exports, admins, canEdit] = await Promise.all([
    listReportSchedules(client),
    listRecentReportExports(client),
    listReportAdmins(client),
    hasPermission(client, "reports", "edit"),
  ]);
  return (
    <ReportsView
      schedules={schedules}
      exports={exports}
      admins={admins}
      canEdit={canEdit}
      profileId={profile.id}
    />
  );
}
