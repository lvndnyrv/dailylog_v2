import { createClient } from "@supabase/supabase-js";
import type { ComplianceInspectionPack } from "@dailylog/db/queries";
import { InspectionPackView } from "@/components/compliance/inspection-pack-view";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private inspection pack · DailyLog",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function SharedInspection({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.rpc("read_compliance_inspection_share", {
    p_token: token,
  });
  if (error || !data)
    return (
      <main className="mx-auto my-16 max-w-lg rounded-2xl border border-hairline bg-white p-8">
        <h1 className="text-xl font-extrabold text-ink">
          Inspection link unavailable
        </h1>
        <p className="mt-3 text-sm text-muted">
          This link may have expired or been revoked. Ask the center
          administrator for a new 48-hour link.
        </p>
      </main>
    );
  return (
    <InspectionPackView
      pack={data as ComplianceInspectionPack}
      shareToken={token}
    />
  );
}
