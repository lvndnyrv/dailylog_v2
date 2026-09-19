"use server";

import { getMyProfile, hasPermission } from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface DashboardActionState {
  ok?: boolean;
  error?: string;
  queued?: number;
  followUpScheduled?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function sendRoomActivityNudgeAction(
  roomId: string,
  mode: "nudge" | "expected",
): Promise<DashboardActionState> {
  if (!UUID.test(roomId) || !["nudge", "expected"].includes(mode)) {
    return { error: "Choose a valid room response." };
  }
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id || !(await hasPermission(supabase, "rooms", "edit"))) {
    return { error: "Rooms edit permission required." };
  }
  const { data, error } = await supabase.rpc("create_room_activity_nudge", {
    p_classroom_id: roomId,
    p_mode: mode,
  });
  if (error) return { error: error.message };
  const result = data as { queued?: number } | null;
  revalidatePath("/dashboard");
  return { ok: true, queued: Number(result?.queued ?? 0) };
}

export async function sendCredentialReminderAction(
  credentialId: string,
  remindAgain: boolean,
): Promise<DashboardActionState> {
  if (!UUID.test(credentialId)) return { error: "Credential not found." };
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id || !(await hasPermission(supabase, "staff", "edit"))) {
    return { error: "Staff edit permission required." };
  }
  const { data, error } = await supabase.rpc("send_staff_credential_reminder", {
    p_credential_id: credentialId,
    p_remind_again: remindAgain,
  });
  if (error) return { error: error.message };
  const result = data as { sent?: boolean; followUpScheduled?: boolean } | null;
  revalidatePath("/dashboard");
  revalidatePath("/compliance");
  return {
    ok: Boolean(result?.sent),
    followUpScheduled: Boolean(result?.followUpScheduled),
    error: result?.sent ? undefined : "This reminder was already sent today.",
  };
}
