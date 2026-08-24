import { getMyDaycare, listClosures } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import {
  SettingsView,
  type AuditEntry,
  type ParentDataRequest,
} from "@/components/settings/settings-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Settings 11a — center profile (11b), closures (11c), audit log (11d).
export default async function SettingsPage() {
  const supabase = await getServerSupabase();
  const [daycare, closures, auditRes, dataRequestsRes] = await Promise.all([
    getMyDaycare(supabase),
    listClosures(supabase),
    supabase
      .from("audit_log")
      .select("id, action, entity_type, created_at, actor:profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("parent_data_requests")
      .select("id, request_type, status, requested_at, updated_at, profile:profiles!parent_data_requests_profile_id_fkey(full_name,email)")
      .in("status", ["requested", "processing"])
      .order("requested_at", { ascending: true }),
  ]);

  return (
    <>
      <SectionHeader title="Settings" subtitle="The center itself — profile, closures, rules" />
      <SettingsView
        daycare={daycare}
        closures={closures}
        audit={(auditRes.data ?? []) as unknown as AuditEntry[]}
        dataRequests={(dataRequestsRes.data ?? []) as unknown as ParentDataRequest[]}
      />
    </>
  );
}
