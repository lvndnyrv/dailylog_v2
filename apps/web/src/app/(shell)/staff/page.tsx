import { listClassrooms, listPendingStaffInvites, listStaff } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { StaffView } from "@/components/staff/staff-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Staff roster 4a — tabs: Roster / (Timesheets, Time off, Delegations locked) /
// Roles (4o, read-only in Phase 1). Pending invites render as 4d rows.
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const supabase = await getServerSupabase();
  const [staff, invites, classrooms] = await Promise.all([
    listStaff(supabase),
    listPendingStaffInvites(supabase),
    listClassrooms(supabase),
  ]);

  return (
    <>
      <SectionHeader
        title="Staff"
        subtitle={`${staff.length} ${staff.length === 1 ? "person" : "people"}${
          invites.length ? ` · ${invites.length} invite${invites.length > 1 ? "s" : ""} pending` : ""
        }`}
      />
      <StaffView
        staff={staff}
        invites={invites}
        classrooms={classrooms}
        openInvite={params.invite === "1"}
        initialTab={params.tab === "roles" ? "roles" : "roster"}
      />
    </>
  );
}
