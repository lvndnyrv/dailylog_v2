import {
  getMyDaycare,
  listClosures,
  listMyNotificationPreferences,
} from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import {
  SettingsView,
  type AuditEntry,
  type ClientErrorReport,
  type ParentDataRequest,
} from "@/components/settings/settings-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Settings 11a — center profile (11b), closures (11c), audit log (11d).
export default async function SettingsPage() {
  const supabase = await getServerSupabase();
  const [{ data: { user } }, daycare, closures, auditRes, parentDataRequestsRes, accountDeletionRequestsRes, clientErrorsRes, policyRes, notificationPreferences] = await Promise.all([
    supabase.auth.getUser(),
    getMyDaycare(supabase),
    listClosures(supabase),
    supabase
      .from("audit_log")
      .select("id, action, entity_type, created_at, before, after, actor:profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("parent_data_requests")
      .select("id, request_type, status, requested_at, updated_at, profile:profiles!parent_data_requests_profile_id_fkey(full_name,email)")
      .in("status", ["requested", "processing"])
      .order("requested_at", { ascending: true }),
    supabase
      .from("account_deletion_requests")
      .select("id, status, requested_at, updated_at, role, profile:profiles!account_deletion_requests_profile_id_fkey(full_name,email)")
      .in("status", ["requested", "processing"])
      .order("requested_at", { ascending: true }),
    supabase
      .from("client_error_reports")
      .select("id, surface, error_code, app_version, release_channel, framework_reference, created_at, profile:profiles!client_error_reports_profile_id_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("late_pickup_policies")
      .select("*")
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
    listMyNotificationPreferences(supabase).catch(() => []),
  ]);

  return (
    <>
      <SectionHeader title="Settings" subtitle="Center profile, policies and security — changes are logged" />
      <SettingsView
        daycare={daycare}
        closures={closures}
        audit={(auditRes.data ?? []) as unknown as AuditEntry[]}
        dataRequests={[
          ...(parentDataRequestsRes.data ?? []).map((request) => ({ ...request, source: "parent" as const })),
          ...(accountDeletionRequestsRes.data ?? []).map((request) => ({
            ...request,
            source: "account" as const,
            request_type: "deletion" as const,
          })),
        ] as unknown as ParentDataRequest[]}
        clientErrors={(clientErrorsRes.data ?? []) as unknown as ClientErrorReport[]}
        latePickupPolicy={policyRes.data}
        notificationPreferences={notificationPreferences}
        mfaEnabled={user?.factors?.some((factor) => factor.status === "verified") ?? false}
      />
    </>
  );
}
