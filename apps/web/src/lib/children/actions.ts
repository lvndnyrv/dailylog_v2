"use server";

import {
  addPickup,
  archiveChild,
  createChild,
  createParentInvite,
  getMyProfile,
  removePickup,
  updateChild,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export interface ChildActionState {
  error?: string;
  ok?: boolean;
  inviteCode?: string;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// Comma-separated input → text[] ("Peanuts, Dairy" → ['Peanuts','Dairy'])
function list(formData: FormData, key: string): string[] {
  return str(formData, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createChildAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const firstName = str(formData, "first_name");
  const lastName = str(formData, "last_name");
  if (!firstName || !lastName) return { error: "First and last name are required." };

  let childId: string;
  try {
    childId = await createChild(supabase, {
      daycare_id: profile.daycare_id,
      classroom_id: str(formData, "classroom_id") || null,
      first_name: firstName,
      last_name: lastName,
      date_of_birth: str(formData, "date_of_birth") || null,
      enrolled_on: str(formData, "enrolled_on") || null,
      allergies: list(formData, "allergies"),
      medical_notes: str(formData, "medical_notes") || null,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the child." };
  }

  revalidatePath("/children");
  redirect(`/children/${childId}`);
}

export async function updateChildAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");

  try {
    await updateChild(supabase, childId, {
      first_name: str(formData, "first_name"),
      last_name: str(formData, "last_name"),
      preferred_name: str(formData, "preferred_name") || null,
      pronouns: str(formData, "pronouns") || null,
      date_of_birth: str(formData, "date_of_birth") || null,
      enrolled_on: str(formData, "enrolled_on") || null,
      classroom_id: str(formData, "classroom_id") || null,
      home_address: str(formData, "home_address") || null,
      allergies: list(formData, "allergies"),
      medical_notes: str(formData, "medical_notes") || null,
      dietary_needs: str(formData, "dietary_needs") || null,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save changes." };
  }

  revalidatePath(`/children/${childId}`);
  revalidatePath("/children");
  return { ok: true };
}

export async function archiveChildAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await archiveChild(supabase, str(formData, "child_id"));
  revalidatePath("/children");
  redirect("/children");
}

export async function addPickupAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const childId = str(formData, "child_id");
  const fullName = str(formData, "full_name");
  if (!fullName) return { error: "Name is required." };

  try {
    await addPickup(supabase, {
      daycare_id: profile.daycare_id,
      child_id: childId,
      full_name: fullName,
      relationship: str(formData, "relationship") || null,
      phone: str(formData, "phone") || null,
      pin: str(formData, "pin"),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add the pickup." };
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function removePickupAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");
  await removePickup(supabase, str(formData, "pickup_id"));
  revalidatePath(`/children/${childId}`);
}

export async function inviteParentAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");
  const email = str(formData, "email");
  if (!email) return { error: "Email is required." };

  try {
    const code = await createParentInvite(
      supabase,
      childId,
      email,
      str(formData, "relationship") || undefined,
    );
    revalidatePath(`/children/${childId}`);
    return { ok: true, inviteCode: code };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the invite." };
  }
}
