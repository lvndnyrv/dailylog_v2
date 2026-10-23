"use server";

import { getMyProfile } from "@dailylog/db/queries";
import type { Json } from "@dailylog/db";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AnnualAllocationState {
  error?: string;
  ok?: boolean;
}

function cents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

export async function saveAnnualAllocationAction(
  _previous: AnnualAllocationState,
  formData: FormData,
): Promise<AnnualAllocationState> {
  const familyId = String(formData.get("family_id") ?? "");
  const paymentId = String(formData.get("payment_id") ?? "");
  const eventKind = String(formData.get("event_kind") ?? "");
  const lineIds = formData.getAll("line_id").map(String);
  if (!UUID.test(familyId) || !UUID.test(paymentId)
    || !["received", "refunded"].includes(eventKind)
    || lineIds.length < 1 || lineIds.length > 100
    || new Set(lineIds).size !== lineIds.length || lineIds.some((id) => !UUID.test(id))) {
    return { error: "Invalid allocation form. Reload and try again." };
  }

  const allocations: { invoice_line_id: string; amount_cents: number }[] = [];
  let total = 0;
  for (const id of lineIds) {
    const amount = cents(String(formData.get(`amount_${id}`) ?? "0") || "0");
    if (amount === null) return { error: "Enter amounts in dollars with no more than two decimal places." };
    if (amount > 0) {
      allocations.push({ invoice_line_id: id, amount_cents: amount });
      total += amount;
    }
  }

  try {
    const supabase = await getServerSupabase();
    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id || !["owner_admin", "admin"].includes(profile.role)) {
      return { error: "Only a billing admin can allocate these payments." };
    }
    const { data: canEdit, error: permissionError } = await supabase.rpc("has_permission", {
      p_area: "billing", p_action: "edit",
    });
    if (permissionError || !canEdit) return { error: "Billing edit access is required." };
    const { data: payment, error: paymentError } = await supabase.from("payments")
      .select("id, daycare_id, family_id, amount_cents")
      .eq("id", paymentId).single();
    if (paymentError || !payment || payment.daycare_id !== profile.daycare_id
      || payment.family_id !== familyId) {
      return { error: "This payment is no longer available to this family." };
    }
    if (total !== payment.amount_cents || allocations.length === 0) {
      return { error: `The line amounts must add up exactly to ${(payment.amount_cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}.` };
    }
    const { error } = await supabase.rpc("save_billing_annual_payment_allocation", {
      p_payment_id: paymentId,
      p_event_kind: eventKind,
      p_allocations: allocations as Json,
    });
    if (error) {
      if (error.message.includes("original receipt allocation")) {
        return { error: "Allocate the original received payment before its refund." };
      }
      if (error.message.includes("Classify")) {
        return { error: "Classify every current invoice line before allocating this event." };
      }
      if (error.message.includes("invoice total") || error.message.includes("invoice line")) {
        return { error: "The invoice lines or amounts need reconciliation before this allocation can be saved." };
      }
      throw error;
    }
  } catch {
    return { error: "Could not save the allocation. Please review the payment and try again." };
  }

  revalidatePath(`/billing/families/${familyId}`);
  return { ok: true };
}
