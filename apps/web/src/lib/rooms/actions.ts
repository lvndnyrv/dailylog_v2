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
    });
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
    });
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
  if (!educatorId || !roomId) return { error: "Pick an educator and a room." };

  try {
    await assignEducatorToRoom(supabase, educatorId, roomId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not assign." };
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
