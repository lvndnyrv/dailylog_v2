import { getMyDaycare, listClosures } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { SettingsView } from "@/components/settings/settings-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Settings 11a — center profile (11b), closures (11c), audit log (11d).
export default async function SettingsPage() {
  const supabase = await getServerSupabase();
  const [daycare, closures] = await Promise.all([
    getMyDaycare(supabase),
    listClosures(supabase),
  ]);

  return (
    <>
      <SectionHeader title="Settings" subtitle="The center itself — profile, closures, rules" />
      <SettingsView daycare={daycare} closures={closures} />
    </>
  );
}
