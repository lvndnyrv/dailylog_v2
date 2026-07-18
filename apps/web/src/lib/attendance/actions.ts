"use server";

import { getMyProfile, kioskCheck, kioskLookupPin } from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface AttendanceActionState {
  error?: string;
  ok?: boolean;
}

const ARRIVAL_STATUSES = ["no_response", "late", "sick", "excused"] as const;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function checkInAction(
  _prev: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const childId = str(formData, "child_id");
  if (!childId) return { error: "Pick a child." };

  const { error } = await supabase.from("attendance_records").upsert(
    {
      daycare_id: profile.daycare_id,
      child_id: childId,
      date: str(formData, "date") || new Date().toISOString().slice(0, 10),
      checked_in_at: new Date().toISOString(),
      checked_in_by: profile.id,
      checked_out_at: null,
      checked_out_by: null,
      method: "educator",
      status: "present",
      absence_reason: null,
      dropped_off_by: str(formData, "dropped_off_by") || null,
      notes: str(formData, "notes") || null,
    },
    { onConflict: "child_id,date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/attendance");
  return { ok: true };
}

export async function checkOutAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);

  const { error } = await supabase
    .from("attendance_records")
    .update({
      checked_out_at: new Date().toISOString(),
      checked_out_by: profile?.id ?? null,
    })
    .eq("id", str(formData, "record_id"));
  if (error) throw error;

  revalidatePath("/attendance");
}

// Fix check-out 8c — correct a missed or wrong time after the fact.
export async function fixTimesAction(
  _prev: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  const supabase = await getServerSupabase();

  const recordId = str(formData, "record_id");
  const date = str(formData, "date");
  const inTime = str(formData, "in_time");
  const outTime = str(formData, "out_time");

  const toIso = (time: string) =>
    time ? new Date(`${date}T${time}`).toISOString() : null;

  const { error } = await supabase
    .from("attendance_records")
    .update({
      checked_in_at: toIso(inTime),
      checked_out_at: toIso(outTime),
    })
    .eq("id", recordId);
  if (error) return { error: error.message };

  revalidatePath("/attendance");
  return { ok: true };
}

export async function markAbsentAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return;

  const { error } = await supabase.from("attendance_records").upsert(
    {
      daycare_id: profile.daycare_id,
      child_id: str(formData, "child_id"),
      date: str(formData, "date") || new Date().toISOString().slice(0, 10),
      status: "absent",
      absence_reason: str(formData, "reason") || null,
      method: "educator",
      checked_in_at: null,
      checked_out_at: null,
    },
    { onConflict: "child_id,date" },
  );
  if (error) throw error;

  revalidatePath("/attendance");
}

// Admin-web counterpart to the family response in design 8a/8d. The future
// parent flow writes these same attendance states directly.
export async function setArrivalStatusAction(
  formData: FormData,
): Promise<AttendanceActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const childId = str(formData, "child_id");
  const date = str(formData, "date");
  const response = str(formData, "response");
  const note = str(formData, "note");
  if (!childId || !date) return { error: "Child and date are required." };
  if (!ARRIVAL_STATUSES.includes(response as (typeof ARRIVAL_STATUSES)[number])) {
    return { error: "Choose a valid response." };
  }

  if (response === "no_response") {
    const { error } = await supabase.from("attendance_records").upsert(
      {
        daycare_id: profile.daycare_id,
        child_id: childId,
        date,
        status: "present",
        absence_reason: null,
        notes: null,
        method: "educator",
        checked_in_at: null,
        checked_out_at: null,
        checked_in_by: null,
        checked_out_by: null,
      },
      { onConflict: "child_id,date" },
    );
    if (error) return { error: error.message };
    revalidatePath("/attendance");
    return { ok: true };
  }

  const status = response === "late" ? "late" : response === "excused" ? "excused" : "absent";
  const absenceReason = response === "sick" ? "sick" : response === "excused" ? "excused" : null;
  const arrivalNote =
    response === "late" ? note || "Family said they are coming later" : note || null;

  const { error } = await supabase.from("attendance_records").upsert(
    {
      daycare_id: profile.daycare_id,
      child_id: childId,
      date,
      status,
      absence_reason: absenceReason,
      notes: arrivalNote,
      method: "educator",
      checked_in_at: null,
      checked_out_at: null,
      checked_in_by: null,
      checked_out_by: null,
    },
    { onConflict: "child_id,date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/attendance");
  return { ok: true };
}

// ── Kiosk (8b) ───────────────────────────────────────────────────────────────

export interface KioskState {
  error?: string;
  family?: Awaited<ReturnType<typeof kioskLookupPin>>;
  pin?: string;
  result?: { childName: string; direction: string };
}

export async function kioskLookupAction(
  _prev: KioskState,
  formData: FormData,
): Promise<KioskState> {
  const supabase = await getServerSupabase();
  const pin = str(formData, "pin");
  if (pin.length !== 4) return { error: "Enter the 4-digit code." };

  try {
    const family = await kioskLookupPin(supabase, pin);
    if (family.length === 0) return { error: "Code not recognized — ask at the desk." };
    return { family, pin };
  } catch {
    return { error: "Code not recognized — ask at the desk." };
  }
}

export async function kioskCheckAction(
  prev: KioskState,
  formData: FormData,
): Promise<KioskState> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");
  const pin = str(formData, "pin");

  try {
    const direction = await kioskCheck(supabase, childId, pin);
    const family = await kioskLookupPin(supabase, pin);
    revalidatePath("/attendance");
    return {
      family,
      pin,
      result: {
        childName: str(formData, "child_name"),
        direction: direction === "checked_in" ? "checked in" : "checked out",
      },
    };
  } catch (err) {
    return { ...prev, error: err instanceof Error ? err.message : "Try again." };
  }
}
