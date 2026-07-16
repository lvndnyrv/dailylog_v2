"use server";

import {
  createBillingPlan,
  createInvoice,
  getMyProfile,
  recordInvoicePayment,
  voidInvoice,
  type InvoiceLineInput,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface BillingActionState {
  error?: string;
  ok?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// Dollar-string → integer cents without float drift ("1,280.00" → 128000)
function toCents(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  const [dollars, cents = ""] = cleaned.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0") || 0);
}

export async function createInvoiceAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const supabase = await getServerSupabase();

  const childId = str(formData, "child_id");
  const billedTo = str(formData, "billed_to");
  const dueOn = str(formData, "due_on");
  if (!dueOn) return { error: "A due date is required." };

  const descriptions = formData.getAll("line_description").map(String);
  const amounts = formData.getAll("line_amount").map(String);
  const lines: InvoiceLineInput[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i].trim();
    if (!description) continue;
    const cents = toCents(amounts[i] ?? "");
    if (!Number.isFinite(cents) || cents <= 0) {
      return { error: `Line ${i + 1}: enter a dollar amount like 780.00` };
    }
    lines.push({ description, quantity: 1, unit_amount_cents: cents });
  }
  if (lines.length === 0) return { error: "An invoice needs at least one line." };

  try {
    await createInvoice(supabase, childId || null, billedTo || null, dueOn, lines);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the invoice." };
  }

  revalidatePath("/billing");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function recordPaymentAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const supabase = await getServerSupabase();

  const cents = toCents(str(formData, "amount"));
  if (!Number.isFinite(cents) || cents <= 0) {
    return { error: "Enter a dollar amount like 780.00" };
  }

  try {
    await recordInvoicePayment(
      supabase,
      str(formData, "invoice_id"),
      cents,
      str(formData, "method") || "cash",
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record the payment." };
  }

  revalidatePath("/billing");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function voidInvoiceAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await voidInvoice(supabase, str(formData, "invoice_id"));
  revalidatePath("/billing");
  revalidatePath("/dashboard");
}

export async function createPlanAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const name = str(formData, "name");
  const cents = toCents(str(formData, "amount"));
  if (!name) return { error: "Plan name is required." };
  if (!Number.isFinite(cents) || cents <= 0) {
    return { error: "Enter a dollar amount like 950.00" };
  }

  try {
    await createBillingPlan(supabase, {
      daycare_id: profile.daycare_id,
      name,
      amount_cents: cents,
      cadence: str(formData, "cadence") || "monthly",
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the plan." };
  }

  revalidatePath("/billing");
  return { ok: true };
}
