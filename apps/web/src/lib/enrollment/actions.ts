"use server";

import {
  createEnrollment,
  enrollFromPipeline,
  getMyProfile,
  setEnrollmentStage,
  submitEnrollmentInquiry,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface EnrollmentActionState {
  error?: string;
  ok?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function newInquiryAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const guardianName = str(formData, "guardian_name");
  if (!guardianName) return { error: "The family name is required." };

  try {
    await createEnrollment(supabase, {
      daycare_id: profile.daycare_id,
      guardian_name: guardianName,
      guardian_email: str(formData, "guardian_email") || null,
      guardian_phone: str(formData, "guardian_phone") || null,
      child_first_name: str(formData, "child_first_name") || null,
      child_date_of_birth: str(formData, "child_date_of_birth") || null,
      desired_start_date: str(formData, "desired_start") || null,
      source: str(formData, "source") || "walk-in",
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add the inquiry." };
  }

  revalidatePath("/enrollment");
  return { ok: true };
}

export async function setStageAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await setEnrollmentStage(supabase, str(formData, "enrollment_id"), str(formData, "stage"));
  revalidatePath("/enrollment");
}

export async function enrollAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();

  const classroomId = str(formData, "classroom_id");
  if (!classroomId) return { error: "Pick a room." };

  try {
    await enrollFromPipeline(
      supabase,
      str(formData, "enrollment_id"),
      classroomId,
      str(formData, "last_name") || undefined,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not enroll." };
  }

  revalidatePath("/enrollment");
  revalidatePath("/children");
  return { ok: true };
}

// Public form (2g) — no session; the anon client calls the definer RPC.
export async function publicInquiryAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();

  const name = str(formData, "guardian_name");
  const email = str(formData, "guardian_email");
  if (!name || !email) return { error: "Your name and email are required." };

  try {
    await submitEnrollmentInquiry(supabase, {
      daycareId: str(formData, "daycare_id"),
      guardianName: name,
      guardianEmail: email,
      guardianPhone: str(formData, "guardian_phone") || undefined,
      childFirstName: str(formData, "child_first_name") || undefined,
      childDateOfBirth: str(formData, "child_date_of_birth") || undefined,
      classroomId: str(formData, "classroom_id") || undefined,
      desiredStart: str(formData, "desired_start") || undefined,
    });
  } catch {
    return { error: "Something went wrong — please try again or call us." };
  }

  return { ok: true };
}
