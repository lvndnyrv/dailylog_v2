import {
  getEnrollment,
  getEnrollmentSettings,
  getMyDaycare,
  listEnrollmentTourSlots,
  listRoomsLive,
  listStaff,
} from "@dailylog/db/queries";
import { notFound } from "next/navigation";
import { EnrollmentApplicationView } from "@/components/enrollment/enrollment-application-view";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function EnrollmentApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const [enrollment, rooms, tourSlots, staff, settings, daycare] = await Promise.all([
    getEnrollment(supabase, id),
    listRoomsLive(supabase),
    listEnrollmentTourSlots(supabase),
    listStaff(supabase),
    getEnrollmentSettings(supabase),
    getMyDaycare(supabase),
  ]);

  if (!enrollment) notFound();

  return (
    <EnrollmentApplicationView
      enrollment={enrollment}
      rooms={rooms}
      tourSlots={tourSlots}
      educators={staff
        .filter((member) => member.profile?.role === "educator")
        .map((member) => ({ id: member.profile!.id, fullName: member.profile!.full_name }))}
      offerWindowHours={settings?.offer_window_hours ?? 48}
      timeZone={daycare?.timezone ?? "America/Toronto"}
    />
  );
}
