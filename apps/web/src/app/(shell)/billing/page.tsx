import {
  getBillingSummary,
  listBillingPlans,
  listChildTuitionRates,
  listInvoices,
  listRoster,
} from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { BillingView } from "@/components/billing/billing-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Billing 6a — manual-first: plans, invoices, recorded payments. Autopay,
// payouts and parent-side flows arrive with the Stripe integration.
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; invoice?: string }>;
}) {
  const params = await searchParams;
  const supabase = await getServerSupabase();
  const [summary, invoices, plans, tuitionRates, roster] = await Promise.all([
    getBillingSummary(supabase),
    listInvoices(supabase),
    listBillingPlans(supabase),
    listChildTuitionRates(supabase),
    listRoster(supabase),
  ]);

  const monthLabel = new Date().toLocaleDateString("en-CA", { month: "long" });

  return (
    <>
      <SectionHeader
        title="Billing"
        subtitle={`${monthLabel} · ${invoices.length} invoice${invoices.length === 1 ? "" : "s"} · tuition recorded manually until autopay ships`}
      />
      <BillingView
        summary={summary}
        invoices={invoices}
        plans={plans}
        tuitionRates={tuitionRates}
        openNew={params.new === "1"}
        openInvoiceId={params.invoice}
        childrenRows={roster.map((child) => {
          const currentRate = tuitionRates
            .filter((rate) => rate.child_id === child.id && rate.status === "effective" && rate.effective_to === null)
            .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];
          return {
            id: child.id,
            name: `${child.first_name} ${child.last_name}`,
            guardianId: child.guardians.find((g) => g.parent)?.parent?.id ?? null,
            guardianName: child.guardians.find((g) => g.parent)?.parent?.full_name ?? null,
            tuitionRate: currentRate ? {
              amountCents: currentRate.amount_cents,
              roomName: currentRate.classroom?.name ?? "Room tuition",
              effectiveFrom: currentRate.effective_from,
            } : null,
          };
        })}
      />
    </>
  );
}
