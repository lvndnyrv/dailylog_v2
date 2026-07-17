import { getMyDaycare, listClosures } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { SettingsView, type AuditEntry } from "@/components/settings/settings-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Settings 11a — center profile (11b), closures (11c), audit log (11d).
export default async function SettingsPage() {
  const supabase = await getServerSupabase();
  const [daycare, closures, auditRes] = await Promise.all([
    getMyDaycare(supabase),
    listClosures(supabase),
    supabase
      .from("audit_log")
      .select("id, action, entity_type, created_at, actor:profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  return (
    <>
      <SectionHeader title="Settings" subtitle="The center itself — profile, closures, rules" />
      <SettingsView
        daycare={daycare}
        closures={closures}
        audit={(auditRes.data ?? []) as unknown as AuditEntry[]}
      />
    </>
  );
}
