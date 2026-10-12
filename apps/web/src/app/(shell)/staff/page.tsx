import {
  getMyDaycare,
  getMyProfile,
  listCenterRoles,
  listClassrooms,
  listPendingStaffInvites,
  listStaff,
  listStaffDelegations,
  listStaffShifts,
  listStaffTimeEntries,
  listStaffTimeOffCoverageImpacts,
  listStaffTimeOffRequests,
} from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { StaffView } from "@/components/staff/staff-view";
import { addDateDays, dateInTimeZone, isDate, monthRange, startOfWeek } from "@/lib/center-date";
import { getServerSupabase } from "@/lib/supabase/server";

const TABS = ["roster", "timesheets", "time-off", "delegations", "roles"] as const;

// Group 4 staff area: roster 4a, timekeeping 4c/4j–m, delegations 4g/4h,
// roles 4o, and pending-invite lifecycle rows from 4d.
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; tab?: string; week?: string; month?: string; delegate?: string }>;
}) {
  const params = await searchParams;
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  const [staff, invites, classrooms, roles, daycare, delegations] = await Promise.all([
    listStaff(supabase),
    listPendingStaffInvites(supabase),
    listClassrooms(supabase),
    listCenterRoles(supabase),
    getMyDaycare(supabase),
    profile?.role === "owner_admin" ? listStaffDelegations(supabase) : Promise.resolve([]),
  ]);

  const timeZone = daycare?.timezone ?? "America/Toronto";
  const today = dateInTimeZone(new Date(), timeZone);
  const weekStart = startOfWeek(isDate(params.week) ? params.week : today);
  const weekEnd = addDateDays(weekStart, 6);
  const selectedMonth =
    params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)
      ? params.month
      : today.slice(0, 7);
  const month = monthRange(`${selectedMonth}-01`);
  const scheduleFrom = [addDateDays(weekStart, -1), addDateDays(month.from, -1)].sort()[0];
  const scheduleTo = [addDateDays(weekEnd, 2), addDateDays(month.to, 61)].sort()[1];

  let shifts: Awaited<ReturnType<typeof listStaffShifts>> = [];
  let timeEntries: Awaited<ReturnType<typeof listStaffTimeEntries>> = [];
  let timeOff: Awaited<ReturnType<typeof listStaffTimeOffRequests>> = [];
  let timeOffCoverageImpacts: Awaited<ReturnType<typeof listStaffTimeOffCoverageImpacts>> = [];
  let timekeepingError: string | null = null;
  try {
    // Fetch a one-day UTC buffer; the client filters by the center's IANA
    // timezone so midnight shifts stay in the correct local pay period.
    [shifts, timeEntries, timeOff] = await Promise.all([
      listStaffShifts(
        supabase,
        `${scheduleFrom}T00:00:00Z`,
        `${scheduleTo}T00:00:00Z`,
      ),
      listStaffTimeEntries(
        supabase,
        `${addDateDays(weekStart, -1)}T00:00:00Z`,
        `${addDateDays(weekEnd, 2)}T00:00:00Z`,
      ),
      listStaffTimeOffRequests(supabase, month.from, addDateDays(month.to, 60)),
    ]);
    timeOffCoverageImpacts = await listStaffTimeOffCoverageImpacts(
      supabase,
      timeOff.filter((request) => request.status === "pending").map((request) => request.id),
    );
  } catch (error) {
    timekeepingError =
      error instanceof Error ? error.message : "Timekeeping data is unavailable.";
  }

  const requestedTab = params.tab ?? "roster";
  const requestedInitialTab = TABS.includes(requestedTab as (typeof TABS)[number])
    ? (requestedTab as (typeof TABS)[number])
    : "roster";
  const canManageDelegations = profile?.role === "owner_admin";
  const initialTab =
    requestedInitialTab === "delegations" && !canManageDelegations
      ? "roster"
      : requestedInitialTab;

  return (
    <>
      <SectionHeader
        title="Staff"
        subtitle={`${staff.length} ${staff.length === 1 ? "person" : "people"}${
          invites.length ? ` · ${invites.length} invite${invites.length > 1 ? "s" : ""} pending` : ""
        }`}
      />
      <StaffView
        key={`${initialTab}:${params.delegate ?? ""}`}
        staff={staff}
        invites={invites}
        classrooms={classrooms}
        roles={roles}
        delegations={delegations}
        shifts={shifts}
        timeEntries={timeEntries}
        timeOff={timeOff}
        timeOffCoverageImpacts={timeOffCoverageImpacts}
        timeZone={timeZone}
        weekStart={weekStart}
        month={selectedMonth}
        timekeepingError={timekeepingError}
        openInvite={params.invite === "1"}
        initialTab={initialTab}
        canManageDelegations={canManageDelegations}
        currentProfileId={profile!.id}
        defaultDelegationDays={daycare?.default_delegation_days ?? 14}
        initialDelegateProfileId={params.delegate ?? null}
      />
    </>
  );
}
