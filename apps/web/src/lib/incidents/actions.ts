"use server";

import { getMyProfile, signOffIncident } from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface IncidentActionState {
  error?: string;
  ok?: boolean;
}

export async function signOffIncidentAction(
  _prev: IncidentActionState,
  formData: FormData,
): Promise<IncidentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!isAdminRole(profile?.role)) return { error: "Only admins can sign off reports." };

  try {
    await signOffIncident(supabase, String(formData.get("incident_id") ?? ""), profile!.id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not sign the report." };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
