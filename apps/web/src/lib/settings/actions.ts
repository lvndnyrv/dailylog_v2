"use server";

import {
  createClosure,
  deleteClosure,
  getMyProfile,
  updateMyDaycare,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface SettingsActionState {
  error?: string;
  ok?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function updateCenterAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await getServerSupabase();

  const name = str(formData, "name");
  const opensAt = str(formData, "opens_at") || "07:00";
  const closesAt = str(formData, "closes_at") || "18:00";
  if (!name) return { error: "The center name is required." };
  if (opensAt >= closesAt) return { error: "Opening time must be before closing time." };
  const licensedCapacity = Number(str(formData, "licensed_capacity"));
  if (!Number.isInteger(licensedCapacity) || licensedCapacity < 0 || licensedCapacity > 10000) {
    return { error: "Licensed capacity must be a whole number between 0 and 10,000." };
  }

  try {
    await updateMyDaycare(supabase, {
      name,
      address: str(formData, "address") || null,
      phone: str(formData, "phone") || null,
      opens_at: opensAt,
      closes_at: closesAt,
      licensed_capacity: licensedCapacity,
      license_number: str(formData, "license_number") || null,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

function toCents(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  const [dollars, cents = ""] = cleaned.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0") || 0);
}

export async function saveLatePickupPolicyAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const feePerMinuteCents = toCents(str(formData, "fee_per_minute"));
  const dailyCapCents = toCents(str(formData, "daily_cap"));
  const graceMinutes = Number(str(formData, "grace_minutes"));
  const conversationAfterCount = Number(str(formData, "conversation_after_count"));

  if (!Number.isInteger(feePerMinuteCents) || feePerMinuteCents < 0 || feePerMinuteCents > 10000) {
    return { error: "Enter a fee per minute between $0 and $100." };
  }
  if (!Number.isInteger(dailyCapCents) || dailyCapCents < 0 || dailyCapCents > 100000) {
    return { error: "Enter a daily cap between $0 and $1,000." };
  }
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) {
    return { error: "Grace period must be between 0 and 120 minutes." };
  }
  if (!Number.isInteger(conversationAfterCount) || conversationAfterCount < 1 || conversationAfterCount > 20) {
    return { error: "Conversation threshold must be between 1 and 20 pickups." };
  }

  try {
    const supabase = await getServerSupabase();
    const { error } = await supabase.rpc("save_late_pickup_policy", {
      p_fee_per_minute_cents: feePerMinuteCents,
      p_grace_minutes: graceMinutes,
      p_daily_cap_cents: dailyCapCents,
      p_conversation_after_count: conversationAfterCount,
    });
    if (error) throw error;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the policy." };
  }

  revalidatePath("/settings");
  revalidatePath("/attendance");
  return { ok: true };
}

export async function setAdminMfaRequirementAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const required = str(formData, "required") === "true";
  try {
    const supabase = await getServerSupabase();
    const { error } = await supabase.rpc("set_admin_mfa_requirement", {
      p_required: required,
    });
    if (error) throw error;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change the security rule.";
    return {
      error: message.includes("two-step") || message.includes("AAL2")
        ? "Verify your own account with two-step authentication before changing this rule."
        : message,
    };
  }

  revalidatePath("/settings");
  return { ok: true };
}

export async function addClosureAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const startsOn = str(formData, "starts_on");
  const endsOn = str(formData, "ends_on") || startsOn;
  const reason = str(formData, "reason");
  const familyMessage = str(formData, "family_message");
  const reminderDays = Number(str(formData, "reminder_days_before") || 3);
  if (!startsOn || !reason) return { error: "Date and reason are required." };
  if (endsOn < startsOn) return { error: "The end date is before the start." };
  if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 30) {
    return { error: "Reminder days must be between 0 and 30." };
  }

  try {
    await createClosure(supabase, {
      daycare_id: profile.daycare_id,
      starts_on: startsOn,
      ends_on: endsOn,
      reason,
      family_message: familyMessage || null,
      family_visible: true,
      billing_treatment: "no_charge",
      reminder_days_before: reminderDays,
      published_at: new Date().toISOString(),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add the closure." };
  }

  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteClosureAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await deleteClosure(supabase, str(formData, "closure_id"));
  revalidatePath("/settings");
}

export async function updateParentDataRequestAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const requestId = str(formData, "request_id");
  const nextStatus = str(formData, "status");
  if (!requestId || !["processing", "completed"].includes(nextStatus)) {
    throw new Error("Invalid privacy request update.");
  }

  const { data: request, error: loadError } = await supabase
    .from("parent_data_requests")
    .select("id,status")
    .eq("id", requestId)
    .single();
  if (loadError || !request) throw new Error(loadError?.message || "Privacy request not found.");

  const allowed = request.status === "requested"
    ? nextStatus === "processing"
    : request.status === "processing" && nextStatus === "completed";
  if (!allowed) throw new Error("This privacy request has already moved to another stage.");

  const { data: updated, error: updateError } = await supabase
    .from("parent_data_requests")
    .update({
      status: nextStatus,
      completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", requestId)
    .eq("status", request.status)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    throw new Error(updateError?.message || "This privacy request changed. Refresh and try again.");
  }

  revalidatePath("/settings");
}
