import {
  listFloaters,
  listRoomsLive,
  listRoomTransitions,
} from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { RoomsView } from "@/components/rooms/rooms-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Rooms & ratios 7a — live ratio per room from today's check-ins vs assigned
// educators, floater pool, transitions panel (7e). Coverage timelines wait for
// staff scheduling (Phase 5) — see DECISIONS.md.
export default async function RoomsPage() {
  const supabase = await getServerSupabase();
  const [rooms, floaters, transitions] = await Promise.all([
    listRoomsLive(supabase),
    listFloaters(supabase),
    listRoomTransitions(supabase),
  ]);

  const over = rooms.filter(
    (room) =>
      room.ratio_children_per_educator !== null &&
      Number(room.present_count) >
        (room.educators.length || 0) * room.ratio_children_per_educator,
  ).length;

  return (
    <>
      <SectionHeader
        title="Rooms & ratios"
        subtitle={`${rooms.length} rooms · ratios counted live from check-ins${
          over ? ` · ${over} over ratio` : " · all in ratio"
        }`}
      />
      <RoomsView rooms={rooms} floaters={floaters} transitions={transitions} />
    </>
  );
}
