import {
  getFamily, getMyDaycare, getMyProfile, listFamilyInvoices, listFamilyLedger,
  listFamilyPaymentsForReview,
} from "@dailylog/db/queries";
import { dateInTimeZone } from "@/lib/center-date";
import { annualReviewExportRows } from "@/lib/billing/annual-review-export";
import { annualInvoiceTiming } from "@/lib/billing/annual-invoice-timing";
import { csvRows } from "@/lib/csv";
import { getServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

async function pages<T>(load: (from: number, to: number) => Promise<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const all: T[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const { data, error } = await load(from, from + size - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < size) return all;
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404, headers: privateHeaders });
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id || profile.archived_at || !["owner_admin", "admin"].includes(profile.role)) {
    return new Response("Not found", { status: 404, headers: privateHeaders });
  }
  const { data: permitted, error: permissionError } = await supabase.rpc("has_permission", {
    p_area: "billing", p_action: "edit",
  });
  if (permissionError || !permitted) return new Response("Not found", { status: 404, headers: privateHeaders });
  const family = await getFamily(supabase, id).catch((error: { code?: string }) => {
    if (error.code === "PGRST116") return null;
    throw error;
  });
  if (!family || family.daycare_id !== profile.daycare_id) {
    return new Response("Not found", { status: 404, headers: privateHeaders });
  }
  const daycare = await getMyDaycare(supabase);
  if (!daycare || daycare.id !== profile.daycare_id) {
    return new Response("Not found", { status: 404, headers: privateHeaders });
  }
  const timeZone = daycare.timezone ?? "America/Toronto";
  const currentYear = Number(dateInTimeZone(new Date(), timeZone).slice(0, 4));
  const requestedYear = Number(new URL(request.url).searchParams.get("year"));
  if (![currentYear, currentYear - 1, currentYear - 2].includes(requestedYear)) {
    return new Response("Select an available review year", { status: 400, headers: privateHeaders });
  }
  const eventYear = (value: string | null) => value
    ? Number(dateInTimeZone(value, timeZone).slice(0, 4)) : null;

  const [invoices, payments, ledger, lineReviews, allocations, adjustmentReviews, timingReviews] = await Promise.all([
    listFamilyInvoices(supabase, id),
    listFamilyPaymentsForReview(supabase, id),
    listFamilyLedger(supabase, id),
    pages(async (from, to) => supabase.from("billing_annual_line_reviews")
      .select("invoice_line_id, classification, note, reviewed_line_description, reviewed_line_amount_cents, service_start_on, service_end_on, service_evidence_note, reviewed_at")
      .eq("family_id", id).eq("review_year", requestedYear).order("invoice_line_id").range(from, to)),
    pages(async (from, to) => supabase.from("billing_annual_payment_allocations")
      .select("payment_id, event_kind, invoice_line_id, amount_cents, allocated_at")
      .eq("family_id", id).eq("review_year", requestedYear)
      .order("payment_id").order("event_kind").order("invoice_line_id").range(from, to)),
    pages(async (from, to) => supabase.from("billing_annual_adjustment_reviews")
      .select("ledger_entry_id, disposition, invoice_line_id, note, reviewed_entry_amount_cents, reviewed_entry_description, reviewed_entry_effective_at, reviewed_line_description, reviewed_line_amount_cents, reviewed_at")
      .eq("family_id", id).eq("review_year", requestedYear).order("ledger_entry_id").range(from, to)),
    pages(async (from, to) => supabase.from("billing_annual_invoice_timing_reviews")
      .select("invoice_id, disposition, note, reviewed_issued_on, reviewed_invoice_status, reviewed_invoice_total_cents, reviewed_billed_cents, reviewed_received_cents, reviewed_refunded_cents, reviewed_at")
      .eq("family_id", id).eq("review_year", requestedYear).order("invoice_id").range(from, to)),
  ]);
  const generatedAt = new Date().toISOString();
  const rows = annualReviewExportRows({
    year: requestedYear, centerId: daycare.id, centerName: daycare.name,
    familyId: family.id, familyName: family.display_name, generatedAt, timeZone, invoices, payments,
    ledger, lineReviews, allocations, adjustmentReviews, timingReviews, eventYear,
    timingRows: annualInvoiceTiming(requestedYear, invoices, payments, eventYear),
  });
  const { error: auditError } = await supabase.rpc("record_billing_annual_review_export", {
    p_family_id: id, p_review_year: requestedYear,
  });
  if (auditError) throw auditError;
  return new Response(`\uFEFF${csvRows(rows)}\r\n`, {
    headers: {
      ...privateHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dailylog-billing-review-${requestedYear}-${id}.csv"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
