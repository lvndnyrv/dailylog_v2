"use server";

import {
  createDaycareLocation,
  getMyProfile,
  switchDaycareLocation,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export interface LocationActionState {
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function switchLocationAction(formData: FormData): Promise<void> {
  const daycareId = value(formData, "daycare_id");
  if (!UUID.test(daycareId)) return;
  const supabase = await getServerSupabase();
  await switchDaycareLocation(supabase, daycareId);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function createLocationAction(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const label = value(formData, "location_label");
  if (label.length < 2) return { error: "Enter a location name." };

  try {
    const supabase = await getServerSupabase();
    const profile = await getMyProfile(supabase);
    if (profile?.role !== "owner_admin") return { error: "Only the owner can add a location." };
    const daycareId = await createDaycareLocation(supabase, {
      label,
      address: value(formData, "address") || null,
      color: value(formData, "color") || "#2F7CD8",
    });
    await switchDaycareLocation(supabase, daycareId);
    revalidatePath("/", "layout");
    redirect("/dashboard");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not add the location." };
  }
}
