"use server";

import { getMyProfile } from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISPOSITIONS = new Set(["explained_timing", "explained_open_balance", "accounting_followup"]);

export interface AnnualTimingState {
  error?: string;
  ok?: boolean;
}

export async function saveAnnualTimingAction(
  _previous: AnnualTimingState,
  formData: FormData,
): Promise<AnnualTimingState> {
  const familyId = String(formData.get("family_id") ?? "");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const year = Number(formData.get("review_year"));
  const disposition = String(formData.get("disposition") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID.test(familyId) || !UUID.test(invoiceId) || !Number.isInteger(year)
    || year < 2000 || year > 2100 || !DISPOSITIONS.has(disposition)
    || note.length < 8 || note.length > 500) {
    return { error: "Choose a disposition and explain it in 8–500 characters." };
  }
  try {
    const supabase = await getServerSupabase();
    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id || !["owner_admin", "admin"].includes(profile.role)) {
      return { error: "Only a billing admin can record this review." };
    }
    const { data: invoice, error: invoiceError } = await supabase.from("invoices")
      .select("family_id, daycare_id").eq("id", invoiceId).single();
    if (invoiceError || !invoice || invoice.family_id !== familyId
      || invoice.daycare_id !== profile.daycare_id) {
      return { error: "This invoice is not part of this family." };
    }
    const { error } = await supabase.rpc("save_billing_annual_invoice_timing_review", {
      p_invoice_id: invoiceId,
      p_review_year: year,
      p_disposition: disposition,
      p_note: note,
    });
    if (error) return { error: "Could not save. The invoice may have changed or no difference remains." };
  } catch {
    return { error: "Could not save this internal review. Please try again." };
  }
  revalidatePath(`/billing/families/${familyId}`);
  return { ok: true };
}
