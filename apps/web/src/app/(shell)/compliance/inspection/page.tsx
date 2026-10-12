import {
  getComplianceInspectionPack,
  listComplianceShares,
} from "@dailylog/db/queries";
import { getServerSupabase } from "@/lib/supabase/server";
import { InspectionPackView } from "@/components/compliance/inspection-pack-view";
import { ComplianceAccessNotice } from "@/components/compliance/access-notice";

export default async function InspectionPage() {
  const client = await getServerSupabase();
  const { data: allowed, error } = await client.rpc("can_access_compliance");
  if (error) throw error;
  if (!allowed) return <ComplianceAccessNotice />;
  const [pack, shares, permission] = await Promise.all([
    getComplianceInspectionPack(client),
    listComplianceShares(client),
    client.rpc("can_access_compliance", { p_write: true }),
  ]);
  return (
    <InspectionPackView
      pack={pack}
      shares={shares}
      canEdit={permission.data === true}
    />
  );
}
