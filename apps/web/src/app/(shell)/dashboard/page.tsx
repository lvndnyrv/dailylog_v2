import {
  getMyProfile,
  listAttendanceDay,
  listIncidentsAwaitingSignoff,
  listRoomsLive,
} from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Dashboard 9a — today at a glance, needs-attention queue, rooms strip.
// Every control reaches a real surface: floater → /rooms, sign-off → 9b modal,
// attendance → /attendance. Billing tile fills in with Phase 4.
export default async function DashboardPage() {
  const supabase = await getServerSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const [profile, rooms, incidents, attendance] = await Promise.all([
    getMyProfile(supabase),
    listRoomsLive(supabase),
    listIncidentsAwaitingSignoff(supabase),
    listAttendanceDay(supabase, today),
  ]);

  const firstName = profile?.full_name.split(" ")[0] ?? "there";

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
      <DashboardView rooms={rooms} incidents={incidents} attendance={attendance} />
    </>
  );
}
