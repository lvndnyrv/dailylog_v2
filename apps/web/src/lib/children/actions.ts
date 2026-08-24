"use server";

import type { Json } from "@dailylog/db";
import {
  addPickup,
  archiveChild,
  createChild,
  createParentInvite,
  enqueueEmailNotification,
  getMyProfile,
  removePickup,
  saveMedicationAuthorization,
  setChildConsent,
  unlinkParent,
  updateChild,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export interface ChildActionState {
  error?: string;
  ok?: boolean;
  inviteCode?: string;
  emailQueued?: boolean;
  pin?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARENT_DOCUMENT_KINDS: Record<string, string> = {
  immunization: "Updated immunization record",
  allergy_medical: "Allergy & medical form",
  birth_certificate: "Birth certificate",
  custody: "Custody document",
  emergency_contact: "Emergency contact form",
  other: "Requested family document",
};

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

  const firstName = str(formData, "first_name");
  const lastName = str(formData, "last_name");
  if (!firstName || !lastName) return { error: "First and last name are required." };

  // Emergency contacts arrive as parallel arrays (19d Family & pickups tab).
  const names = formData.getAll("ec_name").map(String);
  const relations = formData.getAll("ec_relation").map(String);
  const phones = formData.getAll("ec_phone").map(String);
  const emergencyContacts = names
    .map((name, i) => ({
      name: name.trim(),
      relation: (relations[i] ?? "").trim(),
      phone: (phones[i] ?? "").trim(),
    }))
    .filter((c) => c.name || c.phone);

  const weeklySchedule = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri"].map((day) => {
      const value = str(formData, `schedule_${day}`);
      return [day, value === "full" || value === "half" ? value : "off"];
    }),
  );
  const { data: currentChild, error: currentChildError } = await supabase
    .from("children")
    .select("setup_state")
    .eq("id", childId)
    .single();
  if (currentChildError) return { error: currentChildError.message };
  const setupState =
    currentChild.setup_state &&
    typeof currentChild.setup_state === "object" &&
    !Array.isArray(currentChild.setup_state)
      ? (currentChild.setup_state as Record<string, unknown>)
      : {};

  const existingPhoto = str(formData, "existing_photo_url") || null;
  const removePhoto = str(formData, "remove_photo") === "true";
  const photo = formData.get("photo");
  let photoPath: string | null | undefined = removePhoto ? null : undefined;
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith("image/")) return { error: "Choose an image file." };
    if (photo.size > 5 * 1024 * 1024) return { error: "Profile photos must be 5 MB or smaller." };
    const extension = photo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    photoPath = `${childId}/profile-${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("child-avatars").upload(photoPath, photo, {
      contentType: photo.type,
      upsert: false,
    });
    if (error) return { error: error.message };
  }

  try {
    await updateChild(supabase, childId, {
      first_name: firstName,
      last_name: lastName,
      preferred_name: str(formData, "preferred_name") || null,
      pronouns: str(formData, "pronouns") || null,
      date_of_birth: str(formData, "date_of_birth") || null,
      enrolled_on: str(formData, "enrolled_on") || null,
      classroom_id: str(formData, "classroom_id") || null,
      home_address: str(formData, "home_address") || null,
      allergies: list(formData, "allergies"),
      medical_notes: str(formData, "medical_notes") || null,
      dietary_needs: str(formData, "dietary_needs") || null,
      emergency_contacts: emergencyContacts,
      setup_state: { ...setupState, weekly_schedule: weeklySchedule },
      ...(photoPath !== undefined ? { photo_url: photoPath } : {}),
    });
  } catch (err) {
    if (photoPath) await supabase.storage.from("child-avatars").remove([photoPath]);
    return { error: err instanceof Error ? err.message : "Could not save changes." };
  }

  if (existingPhoto && photoPath !== undefined && existingPhoto !== photoPath) {
    await supabase.storage.from("child-avatars").remove([existingPhoto]);
  }

  revalidatePath(`/children/${childId}`);
  revalidatePath("/children");
  return { ok: true };
}

export async function unlinkParentAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");
  await unlinkParent(supabase, childId, str(formData, "parent_id"));
  revalidatePath(`/children/${childId}`);
}

export async function setConsentAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return;
  const childId = str(formData, "child_id");

  await setChildConsent(supabase, {
    daycare_id: profile.daycare_id,
    child_id: childId,
    kind: str(formData, "kind"),
    granted: str(formData, "granted") === "true",
  });
  revalidatePath(`/children/${childId}`);
}

export async function archiveChildAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await archiveChild(supabase, str(formData, "child_id"));
  revalidatePath("/children");
  redirect("/children");
}

export async function duplicateChildAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) redirect("/children");

  const sourceId = str(formData, "child_id");
  const { data: source, error: sourceError } = await supabase
    .from("children")
    .select("first_name, last_name, date_of_birth, classroom_id, setup_state")
    .eq("id", sourceId)
    .single();
  if (sourceError || !source) redirect("/children");

  const sourceSetup =
    source.setup_state && typeof source.setup_state === "object" && !Array.isArray(source.setup_state)
      ? (source.setup_state as Record<string, unknown>)
      : {};
  const { data: duplicate, error } = await supabase
    .from("children")
    .insert({
      daycare_id: profile.daycare_id,
      classroom_id: source.classroom_id,
      first_name: `${source.first_name} copy`,
      last_name: source.last_name,
      date_of_birth: source.date_of_birth,
      setup_state: {
        basics: true,
        photo: false,
        medical: false,
        emergency: false,
        parents: false,
        ...(sourceSetup.weekly_schedule ? { weekly_schedule: sourceSetup.weekly_schedule } : {}),
      } as unknown as Json,
    })
    .select("id")
    .single();
  if (error || !duplicate) redirect("/children");

  revalidatePath("/children");
  redirect(`/children/${duplicate.id}?edit=1`);
}

export async function addPickupAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const supabase = await getServerSupabase();

  const childId = str(formData, "child_id");
  const fullName = str(formData, "full_name");
  if (!fullName) return { error: "Name is required." };

  let pin: string;
  try {
    pin = await addPickup(supabase, {
      child_id: childId,
      full_name: fullName,
      relationship: str(formData, "relationship") || null,
      phone: str(formData, "phone") || null,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add the pickup." };
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true, pin };
}

export async function removePickupAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");
  await removePickup(supabase, str(formData, "pickup_id"));
  revalidatePath(`/children/${childId}`);
}

export async function saveMedicationAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const childId = str(formData, "child_id");
  const name = str(formData, "name");
  const dosage = str(formData, "dosage");
  if (!name || !dosage) return { error: "Medication name and dosage are required." };

  try {
    await saveMedicationAuthorization(supabase, {
      id: str(formData, "medication_id") || undefined,
      daycare_id: profile.daycare_id,
      child_id: childId,
      parent_id: str(formData, "parent_id") || null,
      name,
      dosage,
      schedule: str(formData, "schedule") || null,
      notes: str(formData, "notes") || null,
      active: str(formData, "status") === "active",
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the medication." };
  }

  revalidatePath(`/children/${childId}`);
  revalidatePath("/children");
  return { ok: true };
}

export async function uploadChildDocumentAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const childId = str(formData, "child_id");
  const category = str(formData, "category").replace(/[^a-z0-9_-]/gi, "_");
  const title = str(formData, "title");
  const file = formData.get("file");
  if (!childId || !category || !title || !(file instanceof File) || file.size === 0) {
    return { error: "Choose a document to upload." };
  }
  if (file.size > 10 * 1024 * 1024) return { error: "Documents must be 10 MB or smaller." };
  if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
    return { error: "Upload a PDF or image document." };
  }

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
  const path = `${childId}/${category}-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) return { error: uploadError.message };

  const archivedAt = new Date().toISOString();
  const { error: archiveError } = await supabase
    .from("documents")
    .update({ archived_at: archivedAt })
    .eq("child_id", childId)
    .eq("category", category)
    .is("archived_at", null);
  if (archiveError) {
    await supabase.storage.from("documents").remove([path]);
    return { error: archiveError.message };
  }

  const { error: documentError } = await supabase.from("documents").insert({
    daycare_id: profile.daycare_id,
    child_id: childId,
    title,
    category,
    storage_path: path,
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: profile.id,
  });
  if (documentError) {
    await supabase.storage.from("documents").remove([path]);
    return { error: documentError.message };
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function createParentDocumentRequestAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const childId = str(formData, "child_id");
  const kind = str(formData, "kind");
  const message = str(formData, "message");
  const dueOn = str(formData, "due_on");
  const customTitle = str(formData, "title");

  if (!UUID.test(childId)) return { error: "Choose a valid child." };
  if (!PARENT_DOCUMENT_KINDS[kind]) return { error: "Choose a document type." };
  if (kind === "other" && customTitle.length < 2) {
    return { error: "Add a title for the requested document." };
  }
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
    return { error: "Choose a valid due date." };
  }

  try {
    const supabase = await getServerSupabase();
    const { error } = await supabase.rpc("create_parent_document_request", {
      p_child_id: childId,
      p_kind: kind,
      p_title: kind === "other" ? customTitle : PARENT_DOCUMENT_KINDS[kind],
      ...(message ? { p_message: message } : {}),
      ...(dueOn ? { p_due_on: dueOn } : {}),
    });
    if (error) throw error;
    revalidatePath(`/children/${childId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not request the document.",
    };
  }
}

export async function reviewParentDocumentSubmissionAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const childId = str(formData, "child_id");
  const submissionId = str(formData, "submission_id");
  const decision = str(formData, "decision");
  const reason = str(formData, "reason");

  if (!UUID.test(childId) || !UUID.test(submissionId)) {
    return { error: "This document submission is no longer available." };
  }
  if (decision !== "accepted" && decision !== "rejected") {
    return { error: "Choose accept or request another copy." };
  }
  if (decision === "rejected" && !reason) {
    return { error: "Explain what the family needs to correct." };
  }

  try {
    const supabase = await getServerSupabase();
    const { error } = await supabase.rpc("review_parent_document_submission", {
      p_submission_id: submissionId,
      p_decision: decision,
      ...(reason ? { p_reason: reason } : {}),
    });
    if (error) throw error;
    revalidatePath(`/children/${childId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not review the document.",
    };
  }
}

export async function resendParentInviteAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return;
  const childId = str(formData, "child_id");
  const inviteId = str(formData, "invite_id");
  const { data: invite } = await supabase
    .from("child_invite_codes")
    .select("email, code")
    .eq("id", inviteId)
    .eq("child_id", childId)
    .is("used_at", null)
    .single();
  if (!invite?.email) return;

  await supabase
    .from("child_invite_codes")
    .update({ expires_at: new Date(Date.now() + 14 * 86400000).toISOString() })
    .eq("id", inviteId);
  await enqueueEmailNotification(supabase, {
    daycareId: profile.daycare_id,
    recipientEmail: invite.email,
    kind: "parent_invite",
    title: "Reminder: link to your child's DailyLog",
    body: `Enter this one-time code in the DailyLog parent app: ${invite.code}`,
    payload: { type: "parent_invite", inviteCode: invite.code, childId },
    dedupeKey: `parent-invite-reminder:${inviteId}:${new Date().toISOString().slice(0, 10)}`,
  });
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
    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id) return { error: "No center on your profile." };
    const code = await createParentInvite(
      supabase,
      childId,
      email,
      str(formData, "relationship") || undefined,
    );
    let emailQueued = true;
    try {
      await enqueueEmailNotification(supabase, {
        daycareId: profile.daycare_id,
        recipientEmail: email,
        kind: "parent_invite",
        title: "You're invited to your child's DailyLog",
        body: `Create or sign in to your DailyLog parent account, then enter this one-time code: ${code}`,
        payload: { type: "parent_invite", inviteCode: code, childId },
        dedupeKey: `parent-invite:${code}`,
      });
    } catch {
      emailQueued = false;
    }
    revalidatePath(`/children/${childId}`);
    return { ok: true, inviteCode: code, emailQueued };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the invite." };
  }
}
