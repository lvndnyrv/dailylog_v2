"use server";

import {
  assignEducatorToRoom,
  createRoom,
  getMyProfile,
  updateRoom,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export interface RoomActionState {
  error?: string;
  ok?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function num(formData: FormData, key: string): number | null {
  const value = str(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function createRoomAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const name = str(formData, "name");
  if (!name) return { error: "Room name is required." };

  let roomId: string;
  try {
    roomId = await createRoom(supabase, {
      daycare_id: profile.daycare_id,
      name,
      age_group: str(formData, "age_group") || null,
      min_age_months: num(formData, "min_age_months"),
      max_age_months: num(formData, "max_age_months"),
      capacity: num(formData, "capacity"),
      ratio_children_per_educator: num(formData, "ratio"),
      opens_on: str(formData, "opens_on") || null,
      nap_start: str(formData, "nap_start") || null,
      nap_end: str(formData, "nap_end") || null,
      lead_educator_id: str(formData, "lead_educator_id") || null,
    });
    const leadEducatorId = str(formData, "lead_educator_id");
    if (leadEducatorId) await assignEducatorToRoom(supabase, leadEducatorId, roomId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the room." };
  }

  revalidatePath("/rooms");
  redirect(`/rooms/${roomId}`);
}

export async function updateRoomAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const roomId = str(formData, "room_id");

  try {
    await updateRoom(supabase, roomId, {
      name: str(formData, "name"),
      age_group: str(formData, "age_group") || null,
      min_age_months: num(formData, "min_age_months"),
      max_age_months: num(formData, "max_age_months"),
      capacity: num(formData, "capacity"),
      ratio_children_per_educator: num(formData, "ratio"),
      opens_on: str(formData, "opens_on") || null,
      nap_start: str(formData, "nap_start") || null,
      nap_end: str(formData, "nap_end") || null,
      lead_educator_id: str(formData, "lead_educator_id") || null,
    });
    const leadEducatorId = str(formData, "lead_educator_id");
    if (leadEducatorId) await assignEducatorToRoom(supabase, leadEducatorId, roomId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the room." };
  }

  revalidatePath("/rooms");
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true };
}

// 7d "Edit ratio rules" — one ratio per room, saved in a single pass.
export async function updateRatioRulesAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();

  const roomIds = formData.getAll("room_id").map(String);
  const ratios = formData.getAll("ratio").map(String);

  try {
    for (let i = 0; i < roomIds.length; i++) {
      const ratio = Number(ratios[i]);
      if (!Number.isFinite(ratio) || ratio < 1) continue;
      await updateRoom(supabase, roomIds[i], { ratio_children_per_educator: ratio });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the rules." };
  }

  revalidatePath("/rooms");
  return { ok: true };
}

export async function assignFloaterAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();

  const educatorId = str(formData, "educator_id");
  const roomId = str(formData, "room_id");
  const date = str(formData, "date");
  const startsAt = str(formData, "starts_at");
  const endsAt = str(formData, "ends_at");
  const timeZone = str(formData, "time_zone") || "America/Toronto";
  if (!educatorId || !roomId || !date || !startsAt || !endsAt) {
    return { error: "Pick an educator, room, and coverage time." };
  }

  try {
    const { data: member, error: memberError } = await supabase
      .from("staff_members")
      .select("id")
      .eq("profile_id", educatorId)
      .eq("status", "active")
      .is("archived_at", null)
      .single();
    if (memberError) throw memberError;

    const startIso = zonedLocalToIso(date, startsAt, timeZone);
    const endIso = zonedLocalToIso(date, endsAt, timeZone);
    if (new Date(endIso) <= new Date(startIso)) {
      return { error: "Coverage must end after it starts." };
    }

    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id) return { error: "No center on your profile." };
    const { error } = await supabase.from("room_coverage_assignments").insert({
      daycare_id: profile.daycare_id,
      classroom_id: roomId,
      staff_member_id: member.id,
      starts_at: startIso,
      ends_at: endIso,
      status: "assigned",
      notes: str(formData, "notes") || null,
    });
    if (error) throw error;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not assign." };
  }

  revalidatePath("/rooms");
  return { ok: true };
}

export async function updateRatioAlertsAction(
  values: {
    afterMinutes: number;
    notifyFloaters: boolean;
    blockCheckins: boolean;
  },
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  if (!Number.isFinite(values.afterMinutes) || values.afterMinutes < 0 || values.afterMinutes > 120) {
    return { error: "Alert delay must be between 0 and 120 minutes." };
  }

  const { error } = await supabase
    .from("daycares")
    .update({
      ratio_alert_after_minutes: values.afterMinutes,
      ratio_notify_floaters: values.notifyFloaters,
      ratio_block_checkins: values.blockCheckins,
    })
    .eq("id", profile.daycare_id);
  if (error) return { error: error.message };
  revalidatePath("/rooms");
  return { ok: true };
}

export async function planRoomTransitionAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const childId = str(formData, "child_id");
  const fromRoomId = str(formData, "from_room_id");
  const toRoomId = str(formData, "to_room_id");
  const moveOn = str(formData, "move_on");
  const transitionWeek = formData.get("transition_week") === "on";
  const transitionStartsOn = str(formData, "transition_starts_on");
  const transitionEndsOn = str(formData, "transition_ends_on");
  if (!childId || !fromRoomId || !toRoomId || !moveOn) {
    return { error: "Child, destination room, and move day are required." };
  }
  if (transitionWeek && (!transitionStartsOn || !transitionEndsOn)) {
    return { error: "Add the start and end of the transition week." };
  }
  if (transitionWeek && (transitionEndsOn < transitionStartsOn || transitionEndsOn >= moveOn)) {
    return { error: "Transition visits must end before the move day." };
  }

  const currentTuition = num(formData, "current_tuition");
  const newTuition = num(formData, "new_tuition");
  if ((currentTuition != null && currentTuition < 0) || (newTuition != null && newTuition < 0)) {
    return { error: "Tuition cannot be negative." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("room_transition_plans")
    .select("id")
    .eq("child_id", childId)
    .eq("status", "planned")
    .maybeSingle();
  if (existingError) return { error: existingError.message };

  const planValues = {
    to_classroom_id: toRoomId,
    move_on: moveOn,
    transition_week: transitionWeek,
    transition_starts_on: transitionWeek ? transitionStartsOn : null,
    transition_ends_on: transitionWeek ? transitionEndsOn : null,
    current_tuition_cents: currentTuition == null ? null : Math.round(currentTuition * 100),
    new_tuition_cents: newTuition == null ? null : Math.round(newTuition * 100),
    currency: "CAD",
    family_message: str(formData, "family_message") || null,
    family_visible: true,
    published_at: existing ? undefined : new Date().toISOString(),
    notes: str(formData, "notes") || null,
    status: "planned",
  };
  const result = existing
    ? await supabase.from("room_transition_plans").update(planValues).eq("id", existing.id)
    : await supabase.from("room_transition_plans").insert({
        daycare_id: profile.daycare_id,
        child_id: childId,
        from_classroom_id: fromRoomId,
        ...planValues,
      });
  if (result.error) return { error: result.error.message };

  revalidatePath("/rooms");
  revalidatePath(`/rooms/${fromRoomId}`);
  return { ok: true };
}

export async function completeRoomTransitionAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const planId = str(formData, "plan_id");
  if (!planId) return { error: "A room transition plan is required." };

  const { error } = await supabase.rpc("complete_room_transition_plan", {
    p_plan_id: planId,
  });
  if (error) return { error: error.message };

  revalidatePath("/rooms");
  return { ok: true };
}

export async function updateRoomCombinationsAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  for (const period of ["morning", "evening"] as const) {
    const source = str(formData, `${period}_source`) || null;
    const host = str(formData, `${period}_host`) || null;
    const startsAt = str(formData, `${period}_starts`);
    const endsAt = str(formData, `${period}_ends`);
    const enabled = formData.get(`${period}_enabled`) === "on";
    if (enabled && (!source || !host || !startsAt || !endsAt)) {
      return { error: `Complete the ${period} combination before enabling it.` };
    }
    if (enabled && source === host) return { error: "Source and host rooms must be different." };

    const { error } = await supabase.from("room_combinations").upsert(
      {
        daycare_id: profile.daycare_id,
        period,
        source_classroom_id: source,
        host_classroom_id: host,
        starts_at: startsAt || (period === "morning" ? "07:00" : "17:00"),
        ends_at: endsAt || (period === "morning" ? "08:00" : "18:00"),
        enabled,
      },
      { onConflict: "daycare_id,period" },
    );
    if (error) return { error: error.message };
  }

  revalidatePath("/rooms");
  return { ok: true };
}

// 7e "Move now" — the smallest real version of "plan a move" (DECISIONS.md:
// scheduled future moves need their own table; Phase 2 moves immediately).
export async function moveChildToRoomAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");
  const roomId = str(formData, "room_id");

  const { error } = await supabase
    .from("children")
    .update({ classroom_id: roomId })
    .eq("id", childId);
  if (error) throw error;

  revalidatePath("/rooms");
  revalidatePath(`/children/${childId}`);
}

function zonedLocalToIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const represented = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
  );
  return new Date(utcGuess - (represented - utcGuess)).toISOString();
}
