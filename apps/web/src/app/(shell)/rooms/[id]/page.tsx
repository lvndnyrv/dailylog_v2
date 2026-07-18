import {
  getMyDaycare,
  getRoomRoster,
  listFloaters,
  listRoomCombinations,
  listRoomCoverageAssignments,
  listRoomsLive,
  listRoomTransitionPlans,
  listRoomTransitions,
  listStaff,
  listStaffShifts,
  listStaffTimeEntries,
  listStaffTimeOffRequests,
} from "@dailylog/db/queries";
import { notFound } from "next/navigation";
import { RoomDetailView } from "@/components/rooms/room-detail-view";
import { addDateDays, dateInTimeZone } from "@/lib/center-date";
import { getServerSupabase } from "@/lib/supabase/server";

// Room detail 7b/7c — live ratio, scheduled educators, coverage gaps,
// roster, settings, and planned child transitions.
export default async function RoomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const daycare = await getMyDaycare(supabase);
  const timeZone = daycare?.timezone ?? "America/Toronto";
  const today = dateInTimeZone(new Date(), timeZone);
  const rangeStart = `${addDateDays(today, -1)}T00:00:00Z`;
  const rangeEnd = `${addDateDays(today, 2)}T00:00:00Z`;

  const [
    rooms,
    roster,
    shifts,
    timeEntries,
    timeOff,
    assignments,
    transitions,
    transitionPlans,
    combinations,
    floaters,
    staff,
  ] = await Promise.all([
    listRoomsLive(supabase),
    getRoomRoster(supabase, id, today),
    listStaffShifts(supabase, rangeStart, rangeEnd),
    listStaffTimeEntries(supabase, rangeStart, rangeEnd),
    listStaffTimeOffRequests(supabase, today, today),
    listRoomCoverageAssignments(supabase, rangeStart, rangeEnd),
    listRoomTransitions(supabase, 3),
    listRoomTransitionPlans(supabase),
    listRoomCombinations(supabase),
    listFloaters(supabase),
    listStaff(supabase),
  ]);
  const room = rooms.find((r) => r.id === id);
  if (!room) notFound();

  return (
    <RoomDetailView
      room={room}
      rooms={rooms}
      roster={roster as never}
      shifts={shifts}
      timeEntries={timeEntries}
      timeOff={timeOff}
      assignments={assignments.filter((item) => item.classroom?.id === id)}
      transitions={transitions.filter((item) => item.room_id === id)}
      transitionPlans={transitionPlans.filter((item) => item.from_classroom_id === id)}
      combinations={combinations.filter(
        (item) => item.source_classroom_id === id || item.host_classroom_id === id,
      )}
      floaters={floaters}
      educators={staff.filter((member) => member.profile?.role === "educator").map((member) => ({
        id: member.profile!.id,
        fullName: member.profile!.full_name,
      }))}
      date={today}
      timeZone={timeZone}
      alertAfterMinutes={daycare?.ratio_alert_after_minutes ?? 10}
    />
  );
}
