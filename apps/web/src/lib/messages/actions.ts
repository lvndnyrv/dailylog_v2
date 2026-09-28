"use server";

import {
  createBroadcast,
  getMyProfile,
  getOrCreateStaffConversation,
  markThreadRead,
  markStaffConversationRead,
  sendStaffMessage,
  sendThreadMessage,
  updateScheduledBroadcast,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

export async function markStaffReadAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const conversationId = str(formData, "conversation_id");
  if (!conversationId) return;
  await markStaffConversationRead(supabase, conversationId).catch(() => {});
  revalidatePath("/messages");
}

export async function sendStaffMessageAction(
  _prev: MessageActionState,
  formData: FormData,
): Promise<MessageActionState> {
  const supabase = await getServerSupabase();
  const body = str(formData, "body");
  const conversationId = str(formData, "conversation_id");
  if (!body) return { error: "Write something first." };
  if (!conversationId) return { error: "Staff conversation not found." };

  try {
    await sendStaffMessage(supabase, conversationId, body);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send." };
  }

  revalidatePath("/messages");
  return { ok: true };
}

export async function startStaffConversationAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const profileId = str(formData, "profile_id");
  if (!profileId) redirect("/messages");
  const conversationId = await getOrCreateStaffConversation(supabase, profileId);
  redirect(`/messages?t=${conversationId}`);
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
  const announcementId = str(formData, "announcement_id");
  const delivery = str(formData, "delivery") || "now";
  const scheduledForValue = str(formData, "scheduled_for");
  let scheduledFor: string | null = null;
  let publishedAt: string | null = new Date().toISOString();
  if (delivery === "schedule") {
    const scheduled = new Date(scheduledForValue);
    if (!scheduledForValue || Number.isNaN(scheduled.getTime())) {
      return { error: "Choose when the broadcast should be sent." };
    }
    if (scheduled.getTime() < Date.now() + 60_000) {
      return { error: "Scheduled delivery must be at least one minute from now." };
    }
    scheduledFor = scheduled.toISOString();
    publishedAt = null;
  }
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
    const deliveryTime = scheduledFor ? new Date(scheduledFor) : new Date();
    if (starts <= deliveryTime) return { error: "The event must start after the broadcast is sent." };
    if (ends <= starts) return { error: "The event end must be after its start." };
    eventAt = starts.toISOString();
    eventEndsAt = ends.toISOString();
  }

  try {
    const values = {
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
      scheduled_for: scheduledFor,
      published_at: publishedAt,
    };
    if (announcementId) {
      await updateScheduledBroadcast(supabase, announcementId, values);
    } else {
      await createBroadcast(supabase, values);
    }
  } catch (err) {
    return {
      error: err instanceof Error
        ? err.message
        : announcementId
          ? "Could not update the scheduled broadcast."
          : "Could not send the broadcast.",
    };
  }

  revalidatePath("/messages");
  return { ok: true };
}

export async function cancelScheduledBroadcastAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) throw new Error("No center on your profile.");
  const announcementId = str(formData, "announcement_id");
  if (!announcementId) throw new Error("Scheduled broadcast not found.");
  await updateScheduledBroadcast(supabase, announcementId, {
    cancelled_at: new Date().toISOString(),
  });
  revalidatePath("/messages");
}
