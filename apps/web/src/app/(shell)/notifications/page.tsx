import { getMyDaycare, getMyProfile } from "@dailylog/db/queries";
import { NotificationActivityView } from "@/components/notifications/notification-activity-view";
import { SectionHeader } from "@/components/shell/header";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const supabase = await getServerSupabase();
  const [profile, daycare] = await Promise.all([
    getMyProfile(supabase),
    getMyDaycare(supabase),
  ]);
  const firstName = profile?.full_name.split(" ")[0] ?? "there";
  const date = new Date().toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <SectionHeader
        title={`Good morning, ${firstName}`}
        subtitle={`${date} · ${daycare?.name ?? "Your center"}`}
      />
      <NotificationActivityView />
    </>
  );
}
