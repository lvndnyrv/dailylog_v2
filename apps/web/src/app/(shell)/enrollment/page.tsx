import {
  getEnrollmentSettings,
  getMyDaycare,
  getMyProfile,
  listEnrollmentChildren,
  listEnrollments,
  listEnrollmentTourSlots,
  listRoomsLive,
  listStaff,
  type EnrollmentSettings,
} from "@dailylog/db/queries";
import { EnrollmentBoard } from "@/components/enrollment/enrollment-board";
import { SectionHeader } from "@/components/shell/header";
import { getServerSupabase } from "@/lib/supabase/server";

function defaultSettings(daycareId: string): EnrollmentSettings {
  return {
    daycare_id: daycareId,
    siblings_first: true,
    staff_children_next: true,
    offer_window_hours: 48,
    auto_offer: true,
    auto_archive_checkins: 2,
    inquiry_reply_hours: 24,
    updated_at: new Date(0).toISOString(),
  };
}

// Group 2 — capacity and waitlist overview, pipeline, applications, tours,
// offers, enrollment lifecycle, departures, and alumni re-enrollment.
export default async function EnrollmentPage({
  searchParams,
}: {
  searchParams: Promise<{ modal?: string }>;
}) {
  const params = await searchParams;
  const supabase = await getServerSupabase();
  const [daycare, profile, enrollments, rooms, tourSlots, settings, children, staff] =
    await Promise.all([
      getMyDaycare(supabase),
      getMyProfile(supabase),
      listEnrollments(supabase),
      listRoomsLive(supabase),
      listEnrollmentTourSlots(supabase),
      getEnrollmentSettings(supabase),
      listEnrollmentChildren(supabase),
      listStaff(supabase),
    ]);

  const daycareId = profile?.daycare_id ?? "";
  const enrolled = rooms.reduce((sum, room) => sum + Number(room.enrolled_count), 0);
  const spots = rooms.reduce(
    (sum, room) => sum + Math.max(0, Number(room.capacity ?? 0) - Number(room.enrolled_count)),
    0,
  );
  const waiting = enrollments.filter((item) =>
    ["active", "offer"].includes(item.waitlist_status),
  ).length;

  return (
    <>
      <SectionHeader
        title="Enrollment & waitlist"
        subtitle={`${enrolled} enrolled · ${spots} spots open · ${waiting} on the waitlist`}
        showUtilities={false}
      />
      <EnrollmentBoard
        key={params.modal ?? "overview"}
        enrollments={enrollments}
        rooms={rooms}
        tourSlots={tourSlots}
        settings={settings ?? defaultSettings(daycareId)}
        enrolledChildren={children}
        educators={staff
          .filter((member) => member.profile?.role === "educator")
          .map((member) => ({
            id: member.profile!.id,
            fullName: member.profile!.full_name,
          }))}
        daycareId={daycareId}
        timeZone={daycare?.timezone ?? "America/Toronto"}
        initialModal={params.modal}
      />
    </>
  );
}
