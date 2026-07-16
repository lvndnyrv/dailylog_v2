"use server";

import {
  createBroadcast,
  getMyProfile,
  markThreadRead,
  sendThreadMessage,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface MessageActionState {
  error?: string;
  ok?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function sendMessageAction(
  _prev: MessageActionState,
  formData: FormData,
): Promise<MessageActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const body = str(formData, "body");
  if (!body) return { error: "Write something first." };

  try {
    await sendThreadMessage(
      supabase,
      str(formData, "conversation_id"),
      str(formData, "child_id"),
      profile.daycare_id,
      profile.id,
      body,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send." };
  }

  revalidatePath("/messages");
  return { ok: true };
}

// Opening a thread marks the family's messages as read.
export async function markReadAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await markThreadRead(supabase, str(formData, "child_id")).catch(() => {});
  revalidatePath("/messages");
}

export async function createBroadcastAction(
  _prev: MessageActionState,
  formData: FormData,
): Promise<MessageActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const title = str(formData, "title");
  const body = str(formData, "body");
  if (!title || !body) return { error: "Title and message are required." };

  try {
    await createBroadcast(supabase, {
      daycare_id: profile.daycare_id,
      author_id: profile.id,
      title,
      body,
      classroom_id: str(formData, "classroom_id") || null,
      pinned: formData.get("pinned") === "on",
      rsvp_enabled: formData.get("rsvp_enabled") === "on",
      event_at: str(formData, "event_at") ? new Date(str(formData, "event_at")).toISOString() : null,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send the broadcast." };
  }

  revalidatePath("/messages");
  return { ok: true };
}
