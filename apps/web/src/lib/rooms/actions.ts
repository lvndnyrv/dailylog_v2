"use server";

import { getMyProfile } from "@dailylog/db/queries";
import { validateRoomSettings } from "./room-validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export interface RoomActionState {
  error?: string;
  ok?: boolean;
  outcome?: "planned" | "waiting" | "cancelled";
  fieldErrors?: Record<string, string>;
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

async function saveRoomSettings(formData: FormData, editing: boolean) {
  const values = Object.fromEntries(Array.from(formData.entries(), ([key, value]) => [key, String(value).trim()]));
  const fieldErrors = validateRoomSettings(values);
  if (Object.keys(fieldErrors).length) return { fieldErrors, error: "Check the highlighted room settings." };
  if (editing && !values.room_id) return { error: "This room is unavailable." };
  const supabase = await getServerSupabase();
  try {
    const { data, error } = await supabase.rpc("save_room_settings", {
    p_room_id: editing ? values.room_id : null!,
    p_settings: values,
    p_expected_updated_at: editing ? values.updated_at : null!,
  });
    if (error) return { error: error.message };
    return { roomId: data };
  } catch {
    return { error: "Could not confirm the save. Close and reopen the room list to check before trying again." };
  }
}

export async function createRoomAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const result = await saveRoomSettings(formData, false);
  if (!result.roomId) return { error: result.error, fieldErrors: result.fieldErrors };
  revalidatePath("/rooms");
  redirect(`/rooms/${result.roomId}`);
}

export async function updateRoomAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const result = await saveRoomSettings(formData, true);
  if (!result.roomId) return { error: result.error, fieldErrors: result.fieldErrors };
  revalidatePath("/rooms");
  revalidatePath(`/rooms/${result.roomId}`);
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

  if (!roomIds.length || roomIds.length !== ratios.length ||
    ratios.some((ratio) => !Number.isInteger(Number(ratio)) || Number(ratio) < 1)) {
    return { error: "Every room needs a positive whole-number ratio. No rules were saved." };
  }
  const { error } = await supabase.rpc("save_room_ratio_rules", {
    p_rules: roomIds.map((room_id, index) => ({ room_id, ratio: Number(ratios[index]) })),
  });
  if (error) return { error: error.message };

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
  if (!educatorId || !roomId || !date || !startsAt || !endsAt) {
    return { error: "Pick an educator, room, and coverage time." };
  }

  try {
    const { error } = await supabase.rpc("assign_planned_room_coverage", {
      p_profile: educatorId, p_room: roomId, p_date: date,
      p_start: startsAt, p_end: endsAt,
      p_confirm: formData.get("confirm_availability") === "on",
      p_notes: str(formData, "notes") || undefined,
    });
    if (error) throw error;
  } catch (err) {
    return { error: err && typeof err === "object" && "message" in err ? String(err.message) : "Could not assign." };
  }

  revalidatePath("/rooms");
  return { ok: true };
}

export async function coverageCandidatesAction(room: string, date: string, start: string, end: string) {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("get_coverage_candidates", { p_room: room, p_date: date, p_start: start, p_end: end });
  return { candidates: data ?? [], error: error?.message };
}

export async function saveCoveragePlanAction(id: string, room: string, date: string, segments: { profile_id: string; start: string; end: string; confirm: boolean; notes: string }[], notifyLead: boolean): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("save_room_coverage_plan", { p_id: id, p_room: room, p_date: date, p_segments: segments, p_notify_lead: notifyLead });
  if (error) return { error: error.message };
  revalidatePath("/rooms", "layout");
  return { ok: true };
}

export async function cancelCoverageAction(id: string): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("cancel_planned_room_coverage", { p_assignment: id });
  if (error) return { error: error.message };
  revalidatePath("/rooms", "layout");
  return { ok: true };
}

export async function roomForecastAction(date: string) {
  const supabase = await getServerSupabase();
  const [forecast, children, bookings, review] = await Promise.all([
    supabase.rpc("get_room_demand_forecast", { p_date: date }),
    supabase.from("children").select("id, first_name, last_name, classroom_id").is("archived_at", null).order("first_name"),
    supabase.from("child_attendance_bookings").select("child_id, expected, arrives_at, leaves_at").eq("booked_on", date),
    supabase.rpc("get_room_coverage_review", { p_date: date }),
  ]);
  const error = forecast.error ?? children.error ?? bookings.error ?? review.error;
  return { rows: forecast.data ?? [], children: children.data ?? [], bookings: bookings.data ?? [], review: review.data ?? [], error: error?.message };
}

export async function saveAttendanceBookingsAction(date: string, bookings: { child_id: string; state: string; arrives_at: string; leaves_at: string }[]): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("save_attendance_bookings", { p_date: date, p_bookings: bookings });
  if (error) return { error: error.message };
  revalidatePath("/rooms", "layout");
  return { ok: true };
}

export async function setPlannedBreakAction(shift: string, start: string, end: string): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("set_planned_shift_break", { p_shift: shift, p_start: start || undefined, p_end: end || undefined });
  if (error) return { error: error.message };
  revalidatePath("/rooms", "layout");
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

  if (str(formData, "intent") === "wait") {
    const result = await supabase.rpc("save_room_transition_wait_request", {
      p_settings: {
        child_id: childId,
        from_room_id: fromRoomId,
        to_room_id: toRoomId,
        not_before: moveOn,
        notes: str(formData, "notes") || null,
      },
    });
    if (result.error) return { error: result.error.message };
    revalidatePath("/rooms");
    revalidatePath(`/rooms/${fromRoomId}`);
    return { ok: true, outcome: "waiting" };
  }
  if (transitionWeek && (!transitionStartsOn || !transitionEndsOn)) {
    return { error: "Add the start and end of the transition week." };
  }
  if (transitionWeek && (transitionEndsOn < transitionStartsOn || transitionEndsOn >= moveOn)) {
    return { error: "Transition visits must end before the move day." };
  }

  const currentTuition = num(formData, "current_tuition");
  const newTuition = num(formData, "new_tuition");
  if (["current_tuition", "new_tuition"].some((key) => str(formData, key) &&
    (!/^\d+(\.\d{1,2})?$/.test(str(formData, key)) || Number(str(formData, key)) > 21474836.47))) {
    return { error: "Use a nonnegative tuition amount with at most two decimal places." };
  }

  const planValues = {
    child_id: childId,
    from_room_id: fromRoomId,
    to_room_id: toRoomId,
    move_on: moveOn,
    transition_week: transitionWeek,
    transition_starts_on: transitionWeek ? transitionStartsOn : null,
    transition_ends_on: transitionWeek ? transitionEndsOn : null,
    current_tuition_cents: currentTuition == null ? null : Math.round(currentTuition * 100),
    new_tuition_cents: newTuition == null ? null : Math.round(newTuition * 100),
    family_message: str(formData, "family_message") || null,
    notes: str(formData, "notes") || null,
  };
  const waitingRequestId = str(formData, "wait_request_id");
  const result = waitingRequestId
    ? await supabase.rpc("convert_room_transition_wait_to_plan", {
        p_request_id: waitingRequestId,
        p_expected_updated_at: str(formData, "wait_updated_at"),
        p_settings: planValues,
      })
    : await supabase.rpc("save_room_transition_plan", {
        p_settings: planValues,
        ...(str(formData, "plan_id") ? { p_plan_id: str(formData, "plan_id"), p_expected_updated_at: str(formData, "updated_at") } : {}),
      });
  if (result.error) return { error: result.error.message };

  revalidatePath("/rooms");
  revalidatePath(`/rooms/${fromRoomId}`);
  return { ok: true, outcome: "planned" };
}

export async function cancelRoomTransitionWaitAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("cancel_room_transition_wait_request", {
    p_request_id: str(formData, "wait_request_id"),
    p_expected_updated_at: str(formData, "wait_updated_at"),
  });
  if (error) return { error: error.message };
  revalidatePath("/rooms");
  revalidatePath("/rooms/[id]", "page");
  return { ok: true, outcome: "cancelled" };
}

export async function completeRoomTransitionAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const planId = str(formData, "plan_id");
  if (!planId) return { error: "A room transition plan is required." };

  const { error } = await supabase.rpc("complete_reviewed_room_transition", {
    p_plan_id: planId,
    p_expected_updated_at: str(formData, "updated_at"),
  });
  if (error) return { error: error.message };

  revalidatePath("/rooms");
  revalidatePath("/rooms/[id]", "page");
  revalidatePath("/children");
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function previewRoomTransition(childId: string, roomId: string, from: string) {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("preview_room_transition", { p_child_id: childId, p_room_id: roomId, p_from: from });
  return { data: data ?? [], error: error?.message };
}

export async function cancelRoomTransitionAction(_prev: RoomActionState, formData: FormData): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("cancel_room_transition_plan", {
    p_plan_id: str(formData, "plan_id"), p_expected_updated_at: str(formData, "updated_at"),
  });
  if (error) return { error: error.message };
  revalidatePath("/rooms");
  revalidatePath("/rooms/[id]", "page");
  return { ok: true };
}

export async function updateRoomCombinationsAction(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const combinations = [];
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

    combinations.push({
        period,
        source_classroom_id: source,
        host_classroom_id: host,
        starts_at: startsAt || (period === "morning" ? "07:00" : "17:00"),
        ends_at: endsAt || (period === "morning" ? "08:00" : "18:00"),
        enabled,
      });
  }
  const { error } = await supabase.rpc("save_room_combinations", { p_combinations: combinations });
  if (error) return { error: error.message };

  revalidatePath("/rooms");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function pauseRoomCombinationAction(id: string, paused: boolean): Promise<RoomActionState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("pause_room_combination_today", { p_id: id, p_paused: paused });
  if (error) return { error: error.message };
  revalidatePath("/rooms", "layout");
  revalidatePath("/dashboard");
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
