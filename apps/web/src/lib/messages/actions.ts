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
  const rsvpEnabled = formData.get("rsvp_enabled") === "on";
  const eventAtValue = str(formData, "event_at");
  const eventEndsAtValue = str(formData, "event_ends_at");
  const eventLocation = str(formData, "event_location");
  let eventAt: string | null = null;
  let eventEndsAt: string | null = null;

  if (rsvpEnabled) {
    if (!eventAtValue || !eventEndsAtValue || !eventLocation) {
      return { error: "Event start, end, and location are required when collecting RSVPs." };
    }
    const starts = new Date(eventAtValue);
    const ends = new Date(eventEndsAtValue);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
      return { error: "Enter a valid event start and end time." };
    }
    if (starts <= new Date()) return { error: "The event must start in the future." };
    if (ends <= starts) return { error: "The event end must be after its start." };
    eventAt = starts.toISOString();
    eventEndsAt = ends.toISOString();
  }

  try {
    await createBroadcast(supabase, {
      daycare_id: profile.daycare_id,
      author_id: profile.id,
      title,
      body,
      classroom_id: str(formData, "classroom_id") || null,
      pinned: formData.get("pinned") === "on",
      rsvp_enabled: rsvpEnabled,
      event_at: eventAt,
      event_ends_at: eventEndsAt,
      event_location: rsvpEnabled ? eventLocation : null,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send the broadcast." };
  }

  revalidatePath("/messages");
  return { ok: true };
}
