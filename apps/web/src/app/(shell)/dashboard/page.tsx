import {
  getBillingSummary,
  getMyProfile,
  listAttendanceDay,
  listEnrollments,
  listIncidentsAwaitingSignoff,
  listRoomsLive,
  listStaff,
} from "@dailylog/db/queries";
import { formatAge } from "@dailylog/shared";
import { SectionHeader } from "@/components/shell/header";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getServerSupabase } from "@/lib/supabase/server";

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

  const [profile, rooms, incidents, attendance, billing, enrollments, staff] =
    await Promise.all([
      getMyProfile(supabase),
      listRoomsLive(supabase),
      listIncidentsAwaitingSignoff(supabase),
      listAttendanceDay(supabase, today),
      getBillingSummary(supabase),
      listEnrollments(supabase),
      listStaff(supabase),
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
    (member.certifications ?? [])
      .filter((c) => c.expires_on && daysUntilExpiry(c.expires_on) <= 30)
      .map((c) => ({
        staffName: member.profile!.full_name,
        item: c.item,
        expiresOn: c.expires_on!,
        room: member.profile!.classroom?.name ?? null,
      })),
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
      <SectionHeader
        title={`Good morning, ${firstName}`}
        subtitle={new Date().toLocaleDateString("en-CA", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      />
      <DashboardView
        key={review === "incident" ? "incident-review" : "dashboard"}
        rooms={rooms}
        incidents={incidents}
        attendance={attendance}
        billing={billing}
        enrollment={{ capacity, filled, waitlist, tours }}
        offers={offers}
        certIssues={certIssues}
        staffing={staffing}
        openIncident={review === "incident"}
      />
    </>
  );
}
