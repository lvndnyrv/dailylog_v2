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
  if (!name) return { error: "The center name is required." };

  try {
    await updateMyDaycare(supabase, {
      name,
      address: str(formData, "address") || null,
      phone: str(formData, "phone") || null,
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
  if (!startsOn || !reason) return { error: "Date and reason are required." };
  if (endsOn < startsOn) return { error: "The end date is before the start." };

  try {
    await createClosure(supabase, {
      daycare_id: profile.daycare_id,
      starts_on: startsOn,
      ends_on: endsOn,
      reason,
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
