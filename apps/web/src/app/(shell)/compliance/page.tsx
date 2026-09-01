import {
  getComplianceInspectionPack,
  listComplianceDocuments,
} from "@dailylog/db/queries";
import { ComplianceView } from "@/components/compliance/compliance-view";
import { getServerSupabase } from "@/lib/supabase/server";
import { ComplianceAccessNotice } from "@/components/compliance/access-notice";

export default async function CompliancePage() {
  const client = await getServerSupabase();
  const { data: allowed, error } = await client.rpc("can_access_compliance");
  if (error) throw error;
  if (!allowed) return <ComplianceAccessNotice />;
  const [pack, documents, permission] = await Promise.all([
    getComplianceInspectionPack(client),
    listComplianceDocuments(client),
    client.rpc("can_access_compliance", { p_write: true }),
  ]);
  return (
    <ComplianceView
      pack={pack}
      documents={documents}
      canEdit={permission.data === true}
    />
  );
}
