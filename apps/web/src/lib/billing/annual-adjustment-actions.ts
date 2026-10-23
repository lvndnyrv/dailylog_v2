"use server";

import { getMyProfile } from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { dateInTimeZone } from "@/lib/center-date";
import { getServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISPOSITIONS = new Set([
  "needs_review", "possible_invoice_relation", "not_child_care", "accounting_followup",
]);

export interface AnnualAdjustmentState {
  error?: string;
  ok?: boolean;
}

export async function saveAnnualAdjustmentAction(
  _previous: AnnualAdjustmentState,
  formData: FormData,
): Promise<AnnualAdjustmentState> {
  const familyId = String(formData.get("family_id") ?? "");
  const entryId = String(formData.get("ledger_entry_id") ?? "");
  const year = Number(formData.get("review_year"));
  const disposition = String(formData.get("disposition") ?? "");
  const requestedLineId = String(formData.get("invoice_line_id") ?? "");
  const lineId = disposition === "possible_invoice_relation" ? requestedLineId : null;
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID.test(familyId) || !UUID.test(entryId) || !Number.isInteger(year)
    || year < 2000 || year > 2100 || !DISPOSITIONS.has(disposition)
    || (lineId !== null && !UUID.test(lineId))) {
    return { error: "Invalid adjustment review. Reload and try again." };
  }
  if (note.length > 500 || (disposition !== "needs_review" && note.length < 8)) {
    return { error: "Add a review reason of 8–500 characters." };
  }

  try {
    const supabase = await getServerSupabase();
    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id || !["owner_admin", "admin"].includes(profile.role)) {
      return { error: "Only a billing admin can review adjustments." };
    }
    const { data: canEdit, error: permissionError } = await supabase.rpc("has_permission", {
      p_area: "billing", p_action: "edit",
    });
    if (permissionError || !canEdit) return { error: "Billing edit access is required." };
    const [{ data: entry, error: entryError }, { data: daycare, error: daycareError }] = await Promise.all([
      supabase.from("family_ledger_entries")
        .select("id, daycare_id, family_id, entry_type, amount_cents, currency, description, effective_at, source_invoice_id")
        .eq("id", entryId).single(),
      supabase.from("daycares").select("timezone").eq("id", profile.daycare_id).single(),
    ]);
    if (entryError || !entry || daycareError || !daycare
      || entry.daycare_id !== profile.daycare_id || entry.family_id !== familyId
      || entry.currency !== "CAD" || !["credit", "adjustment", "writeoff"].includes(entry.entry_type)
      || Number(dateInTimeZone(entry.effective_at, daycare.timezone ?? "America/Toronto").slice(0, 4)) !== year) {
      return { error: "This ledger entry is not available for this review year." };
    }
    let reviewedLineDescription: string | null = null;
    let reviewedLineAmountCents: number | null = null;
    if (lineId) {
      const { data: line, error: lineError } = await supabase.from("invoice_lines")
        .select("id, invoice_id, daycare_id, description, amount_cents")
        .eq("id", lineId).single();
      if (lineError || !line || line.daycare_id !== profile.daycare_id) {
        return { error: "Choose an invoice line from this family." };
      }
      const { data: invoice, error: invoiceError } = await supabase.from("invoices")
        .select("id, daycare_id, family_id, child_id, status")
        .eq("id", line.invoice_id).single();
      if (invoiceError || !invoice || invoice.daycare_id !== profile.daycare_id
        || invoice.family_id !== familyId || !invoice.child_id || invoice.status === "void"
        || (entry.source_invoice_id && entry.source_invoice_id !== invoice.id)) {
        return { error: "Choose a child-linked invoice line from this family and entry." };
      }
      reviewedLineDescription = line.description;
      reviewedLineAmountCents = line.amount_cents;
    }
    const { error } = await supabase.from("billing_annual_adjustment_reviews").upsert({
      ledger_entry_id: entry.id,
      review_year: year,
      daycare_id: profile.daycare_id,
      family_id: familyId,
      disposition,
      invoice_line_id: lineId,
      note,
      reviewed_entry_amount_cents: entry.amount_cents,
      reviewed_entry_description: entry.description,
      reviewed_entry_effective_at: entry.effective_at,
      reviewed_line_description: reviewedLineDescription,
      reviewed_line_amount_cents: reviewedLineAmountCents,
      reviewed_by: profile.id,
    }, { onConflict: "ledger_entry_id" });
    if (error) throw error;
  } catch {
    return { error: "Could not save this adjustment review. Please try again." };
  }
  revalidatePath(`/billing/families/${familyId}`);
  return { ok: true };
}
