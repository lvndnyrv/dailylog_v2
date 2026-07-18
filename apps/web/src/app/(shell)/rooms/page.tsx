import {
  getMyDaycare,
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
import Link from "next/link";
import { SectionHeader } from "@/components/shell/header";
import { RoomsView } from "@/components/rooms/rooms-view";
import { addDateDays, dateInTimeZone } from "@/lib/center-date";
import { getServerSupabase } from "@/lib/supabase/server";

// Rooms & ratios 7a — scheduled coverage, live ratios, floater assignments,
// licensing rules, alert preferences, planned transitions, and combinations.
export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ modal?: string }>;
}) {
  const params = await searchParams;
  const supabase = await getServerSupabase();
  const daycare = await getMyDaycare(supabase);
  const timeZone = daycare?.timezone ?? "America/Toronto";
  const today = dateInTimeZone(new Date(), timeZone);
  const rangeStart = `${addDateDays(today, -1)}T00:00:00Z`;
  const rangeEnd = `${addDateDays(today, 2)}T00:00:00Z`;

  const [
    rooms,
    floaters,
    transitions,
    transitionPlans,
    combinations,
    coverageAssignments,
    shifts,
    timeEntries,
    timeOff,
    staff,
  ] = await Promise.all([
    listRoomsLive(supabase),
    listFloaters(supabase),
    listRoomTransitions(supabase, 3),
    listRoomTransitionPlans(supabase),
    listRoomCombinations(supabase),
    listRoomCoverageAssignments(supabase, rangeStart, rangeEnd),
    listStaffShifts(supabase, rangeStart, rangeEnd),
    listStaffTimeEntries(supabase, rangeStart, rangeEnd),
    listStaffTimeOffRequests(supabase, today, today),
    listStaff(supabase),
  ]);

  return (
    <>
      <SectionHeader
        title="Rooms & ratios"
        subtitle={`${rooms.length} rooms · ratios follow your center rules · alert threshold ${daycare?.ratio_alert_after_minutes ?? 10} min over`}
        showUtilities={false}
        actions={
          <>
            <Link
              href="/rooms?modal=rules"
              className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-[18px] py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
            >
              Edit ratio rules
            </Link>
            <Link
              href="/rooms?modal=add"
              className="rounded-full bg-primary px-[20px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
            >
              + Add a room
            </Link>
          </>
        }
      />
      <RoomsView
        key={params.modal ?? "overview"}
        rooms={rooms}
        floaters={floaters}
        transitions={transitions}
        transitionPlans={transitionPlans}
        combinations={combinations}
        coverageAssignments={coverageAssignments}
        shifts={shifts}
        timeEntries={timeEntries}
        timeOff={timeOff}
        educators={staff
          .filter((member) => member.profile?.role === "educator")
          .map((member) => ({
            id: member.profile!.id,
            staffMemberId: member.id,
            fullName: member.profile!.full_name,
            role: member.profile!.role,
            roomId: member.profile!.classroom?.id ?? null,
          }))}
        date={today}
        timeZone={timeZone}
        alertSettings={{
          afterMinutes: daycare?.ratio_alert_after_minutes ?? 10,
          notifyFloaters: daycare?.ratio_notify_floaters ?? true,
          blockCheckins: daycare?.ratio_block_checkins ?? false,
        }}
        initialModal={params.modal}
      />
    </>
  );
}
