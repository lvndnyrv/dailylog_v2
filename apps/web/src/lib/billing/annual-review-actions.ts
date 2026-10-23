"use server";

import { getMyProfile } from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLASSIFICATIONS = new Set(["needs_review", "care_service_candidate", "exclude"]);

export interface AnnualLineReviewState {
  error?: string;
  ok?: boolean;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function saveAnnualLineReviewAction(
  _previous: AnnualLineReviewState,
  formData: FormData,
): Promise<AnnualLineReviewState> {
  const familyId = String(formData.get("family_id") ?? "");
  const lineId = String(formData.get("invoice_line_id") ?? "");
  const reviewYear = Number(formData.get("review_year"));
  const classification = String(formData.get("classification") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const serviceStart = String(formData.get("service_start_on") ?? "").trim();
  const serviceEnd = String(formData.get("service_end_on") ?? "").trim();
  const serviceEvidence = String(formData.get("service_evidence_note") ?? "").trim();
  if (!UUID.test(familyId) || !UUID.test(lineId) || !Number.isInteger(reviewYear)
    || reviewYear < 2000 || reviewYear > 2100 || !CLASSIFICATIONS.has(classification)) {
    return { error: "Invalid review item. Reload this page and try again." };
  }
  if (note.length > 500 || (classification !== "needs_review" && note.length < 5)) {
    return { error: "Add a reason of at least 5 characters (maximum 500)." };
  }
  if (serviceStart || serviceEnd) {
    if (!validDate(serviceStart) || !validDate(serviceEnd) || serviceStart > serviceEnd) {
      return { error: "Enter a valid care start and end date, in chronological order." };
    }
    if (serviceEvidence.length < 8 || serviceEvidence.length > 500) {
      return { error: "Describe the source of the care dates (8–500 characters)." };
    }
  } else if (serviceEvidence.length > 500) {
    return { error: "Care-date evidence must be 500 characters or fewer." };
  }

  try {
    const supabase = await getServerSupabase();
    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id || !["owner_admin", "admin"].includes(profile.role)) {
      return { error: "Only a billing admin can review these items." };
    }
    const { data: canEdit, error: permissionError } = await supabase.rpc("has_permission", {
      p_area: "billing", p_action: "edit",
    });
    if (permissionError || !canEdit) return { error: "Billing edit access is required." };

    const { data: line, error: lineError } = await supabase.from("invoice_lines")
      .select("id, invoice_id, description, amount_cents, daycare_id")
      .eq("id", lineId).single();
    if (lineError || !line || line.daycare_id !== profile.daycare_id) {
      return { error: "This invoice line is no longer available." };
    }
    const { data: invoice, error: invoiceError } = await supabase.from("invoices")
      .select("id, family_id, child_id, daycare_id, status")
      .eq("id", line.invoice_id).single();
    if (invoiceError || !invoice || invoice.daycare_id !== profile.daycare_id
      || invoice.family_id !== familyId || !invoice.child_id || invoice.status === "void") {
      return { error: "This line is not on an active child-linked invoice for this family." };
    }

    const { error } = await supabase.from("billing_annual_line_reviews").upsert({
      invoice_line_id: line.id,
      review_year: reviewYear,
      daycare_id: profile.daycare_id,
      family_id: familyId,
      classification,
      note,
      reviewed_line_description: line.description,
      reviewed_line_amount_cents: line.amount_cents,
      reviewed_by: profile.id,
      service_start_on: serviceStart || null,
      service_end_on: serviceEnd || null,
      service_evidence_note: serviceEvidence,
    }, { onConflict: "invoice_line_id,review_year" });
    if (error) throw error;
  } catch {
    return { error: "Could not save this review. Please try again." };
  }

  revalidatePath(`/billing/families/${familyId}`);
  return { ok: true };
}
