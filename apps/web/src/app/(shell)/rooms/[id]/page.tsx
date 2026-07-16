import { getRoomRoster, listRoomsLive } from "@dailylog/db/queries";
import { notFound } from "next/navigation";
import { RoomDetailView } from "@/components/rooms/room-detail-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Room detail 7b — live ratio, educators, today's roster.
export default async function RoomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();

  const rooms = await listRoomsLive(supabase);
  const room = rooms.find((r) => r.id === id);
  if (!room) notFound();

  const roster = await getRoomRoster(supabase, id);

  return <RoomDetailView room={room} roster={roster as never} />;
}
