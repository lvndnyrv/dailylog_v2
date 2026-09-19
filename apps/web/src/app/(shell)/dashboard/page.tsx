import {
  getBillingSummary,
  getMyProfile,
  listAttendanceDay,
  listEnrollments,
  listIncidentsAwaitingSignoff,
  listRoomsLive,
  listStaff,
  listComplianceDueItems,
  listInvoices,
  listRecentRoomActivityNudges,
  listRoomCombinations,
  getMyDaycare,
} from "@dailylog/db/queries";
import { formatAge } from "@dailylog/shared";
import { SectionHeader } from "@/components/shell/header";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getServerSupabase } from "@/lib/supabase/server";
import { CombinationControls, LiveRoomsRefresh } from "@/components/rooms/combination-controls";
import { dateInTimeZone } from "@/lib/center-date";

function daysUntilExpiry(date: string): number {
  return Math.round((new Date(`${date}T12:00`).getTime() - Date.now()) / 86400000);
}

// Dashboard 9a — today at a glance, needs-attention queue, rooms & staffing.
// Every control reaches a real surface: floater → /rooms, sign-off → 9b modal,
// cert → /compliance, waitlist → /enrollment.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string }>;
}) {
  const { review } = await searchParams;
  const supabase = await getServerSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const [profile, rooms, incidents, attendance, billing, invoices, enrollments, staff, complianceDue, roomNudges, combinations, center] =
    await Promise.all([
      getMyProfile(supabase),
      listRoomsLive(supabase),
      listIncidentsAwaitingSignoff(supabase),
      listAttendanceDay(supabase, today),
      getBillingSummary(supabase),
      listInvoices(supabase),
      listEnrollments(supabase),
      listStaff(supabase),
      listComplianceDueItems(supabase),
      listRecentRoomActivityNudges(supabase),
      listRoomCombinations(supabase),
      getMyDaycare(supabase),
    ]);

  const firstName = profile?.full_name.split(" ")[0] ?? "there";

  // Enrollment snapshot (right rail + waitlist attention).
  const capacity = rooms.reduce((sum, r) => sum + (r.capacity ?? 0), 0);
  const filled = rooms.reduce((sum, r) => sum + Number(r.enrolled_count), 0);
  const waitlistStages = ["inquiry", "tour", "application", "offer"];
  const waitlist = enrollments.filter((e) => waitlistStages.includes(e.stage)).length;
  const tours = enrollments.filter((e) => e.stage === "tour").length;
  const offers = enrollments
    .filter((e) => e.stage === "offer")
    .map((e) => ({
      id: e.id,
      name: [e.guardian_name, e.child_first_name].filter(Boolean).join(" · "),
      age: e.child_date_of_birth ? formatAge(e.child_date_of_birth) : null,
      start: e.desired_start_date,
    }));

  // Certs expiring within 30 days (or expired) → attention + staffing warnings.
  const certIssues = staff.flatMap((member) =>
    (member.credentials ?? [])
      .filter((c) => (c.required && (!c.completed_on || !c.document_id)) || (c.expires_on && daysUntilExpiry(c.expires_on) <= 30))
      .map((c) => ({
        credentialId: c.id,
        staffMemberId: member.id,
        staffName: member.profile!.full_name,
        jobTitle: member.job_title,
        email: member.profile!.email,
        item: c.name,
        issuer: c.issuer,
        expiresOn: c.expires_on ?? new Date().toISOString().slice(0, 10),
        missing: Boolean(c.required && (!c.completed_on || !c.document_id)),
        ratioQualifying: c.ratio_qualifying,
        room: member.profile!.classroom?.name ?? null,
      })),
  );

  const overdueInvoices = invoices.filter(
    (invoice) => invoice.status === "open" && invoice.due_on && invoice.due_on < today,
  );

  // Assigned educators today (one row per educator, first room).
  const seen = new Set<string>();
  const staffing = rooms.flatMap((room) =>
    room.educators
      .filter((e) => !seen.has(e.id) && seen.add(e.id))
      .map((e) => ({ id: e.id, name: e.full_name, room: room.name })),
  );

  return (
    <>
      <LiveRoomsRefresh />
      <SectionHeader
        title={`Good morning, ${firstName}`}
        subtitle={new Date().toLocaleDateString("en-CA", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      />
      {combinations.some(item => item.enabled && item.activated_at) && <section className="mx-7 mt-5 rounded-2xl border border-hairline bg-card p-4">
        <h2 className="text-sm font-bold text-ink">Open &amp; close · shared rooms</h2>
        <p className="text-xs text-muted">Pause just today if each room needs to operate separately. Weekday schedules resume automatically tomorrow.</p>
        <CombinationControls combinations={combinations} date={dateInTimeZone(new Date(), center?.timezone ?? "UTC")} />
      </section>}
      <DashboardView
        key={review === "incident" ? "incident-review" : "dashboard"}
        rooms={rooms}
        incidents={incidents}
        attendance={attendance}
        billing={billing}
        overdueInvoices={overdueInvoices}
        enrollment={{ capacity, filled, waitlist, tours }}
        offers={offers}
        certIssues={certIssues}
        complianceDue={complianceDue}
        staffing={staffing}
        roomNudges={roomNudges}
        openIncident={review === "incident"}
      />
    </>
  );
}
