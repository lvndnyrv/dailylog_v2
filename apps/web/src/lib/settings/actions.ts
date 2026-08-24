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

  try {
    await updateMyDaycare(supabase, {
      name,
      address: str(formData, "address") || null,
      phone: str(formData, "phone") || null,
      opens_at: opensAt,
      closes_at: closesAt,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save." };
  }

  revalidatePath("/", "layout");
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
