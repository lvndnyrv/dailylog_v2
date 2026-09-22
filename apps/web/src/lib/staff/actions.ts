"use server";

import {
  hasPermission,
  enqueueEmailNotification,
  getMyProfile,
  grantStaffDelegation,
  inviteStaff,
  resendStaffInvite,
  revokeStaffDelegation,
  revokeStaffInvite,
  updateStaffMember,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";

export interface StaffActionState {
  error?: string;
  ok?: boolean;
  inviteLink?: string;
  emailQueued?: boolean;
  expiresAt?: string;
}

export interface TimekeepingActionState {
  error?: string;
  ok?: boolean;
}

export interface DelegationActionState {
  error?: string;
  ok?: boolean;
}

export interface CredentialReviewActionState {
  error?: string;
  ok?: boolean;
}

export interface StaffDocumentActionState {
  error?: string;
  ok?: boolean;
}

export interface StaffBulkActionState {
  error?: string;
  ok?: boolean;
  affected?: number;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireStaffPermission(action: "edit" | "approve") {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile || !(await hasPermission(supabase, "staff", action))) {
    throw new Error(`Staff ${action} permission required.`);
  }
  return { supabase, profile };
}

export async function inviteStaffAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const email = str(formData, "email");
  // The design's three role chips map onto the schema's two roles:
  // "lead" = educator + Lead educator job title (DECISIONS.md).
  const roleChip = str(formData, "role");
  const role = roleChip === "admin" ? "admin" : "educator";
  const jobTitle =
    roleChip === "lead" ? "Lead educator" : roleChip === "educator" ? "Educator" : null;
  if (!email) return { error: "Email is required." };
  if (!["educator", "lead", "admin"].includes(roleChip)) return { error: "Pick a role." };

  try {
    const code = await inviteStaff(supabase, {
      email,
      role,
      classroomId: str(formData, "classroom_id") || null,
      fullName: str(formData, "full_name") || null,
      jobTitle,
      requireBackgroundCheck: formData.get("require_background_check") === "on",
    });
    const origin = (await headers()).get("origin") ?? "";
    const inviteLink = `${origin}/invite?code=${code}`;
    let emailQueued = true;
    try {
      await enqueueEmailNotification(supabase, {
        daycareId: profile.daycare_id,
        recipientEmail: email,
        kind: "staff_invite",
        title: "You're invited to DailyLog",
        body: `Your center invited you to DailyLog. Accept the invitation: ${inviteLink}`,
        payload: { type: "staff_invite", inviteLink },
        dedupeKey: `staff-invite:${code}`,
      });
    } catch {
      emailQueued = false;
    }
    revalidatePath("/staff");
    return { ok: true, inviteLink, emailQueued };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the invite." };
  }
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await revokeStaffInvite(supabase, str(formData, "invite_id"));
  revalidatePath("/staff");
}

export async function resendInviteAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const inviteId = str(formData, "invite_id");
  if (!UUID.test(inviteId)) return { error: "Invalid invitation." };

  try {
    const supabase = await getServerSupabase();
    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id || !(await hasPermission(supabase, "staff", "edit"))) {
      return { error: "Staff edit permission required." };
    }
    const resent = await resendStaffInvite(supabase, inviteId);
    const origin = (await headers()).get("origin") ?? "";
    const inviteLink = `${origin}/invite?code=${resent.code}`;
    let emailQueued = true;
    try {
      await enqueueEmailNotification(supabase, {
        daycareId: profile.daycare_id,
        recipientEmail: resent.email,
        kind: "staff_invite",
        title: "Your updated DailyLog invitation",
        body: `Your center sent a fresh DailyLog invitation. The previous link no longer works. Accept this invitation within seven days: ${inviteLink}`,
        payload: { type: "staff_invite", inviteLink },
        dedupeKey: `staff-invite:${resent.code}`,
      });
    } catch {
      emailQueued = false;
    }
    revalidatePath("/staff");
    return {
      ok: true,
      inviteLink,
      emailQueued,
      expiresAt: resent.expiresAt,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not resend the invitation.",
    };
  }
}

function selectedIds(formData: FormData, key: string): string[] {
  return [...new Set(formData.getAll(key).map(String).filter((value) => UUID.test(value)))];
}

export async function bulkAssignStaffRoomAction(
  _prev: StaffBulkActionState,
  formData: FormData,
): Promise<StaffBulkActionState> {
  const staffIds = selectedIds(formData, "staff_ids");
  const classroomId = str(formData, "classroom_id");
  if (staffIds.length === 0) return { error: "Select at least one educator." };
  if (classroomId && !UUID.test(classroomId)) return { error: "Choose a valid room." };

  try {
    const { supabase } = await requireStaffPermission("edit");
    const { data, error } = await supabase.rpc("bulk_assign_staff_room", {
      p_staff_member_ids: staffIds,
      p_classroom_id: classroomId || null,
    });
    if (error) throw error;
    const result = data as { updated?: number } | null;
    revalidatePath("/staff");
    revalidatePath("/rooms");
    revalidatePath("/dashboard");
    return { ok: true, affected: Number(result?.updated ?? 0) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not assign the room." };
  }
}

export async function bulkMessageStaffAction(
  _prev: StaffBulkActionState,
  formData: FormData,
): Promise<StaffBulkActionState> {
  const profileIds = selectedIds(formData, "profile_ids");
  const body = str(formData, "body");
  if (profileIds.length === 0) return { error: "Select at least one staff member." };
  if (!body) return { error: "Write a message first." };
  if (body.length > 4000) return { error: "Message is too long." };

  try {
    const { supabase } = await requireStaffPermission("edit");
    const { data, error } = await supabase.rpc("send_bulk_staff_message", {
      p_profile_ids: profileIds,
      p_body: body,
    });
    if (error) throw error;
    const result = data as { sent?: number } | null;
    revalidatePath("/staff");
    return { ok: true, affected: Number(result?.sent ?? 0) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not send the message." };
  }
}

const DELEGATION_AREAS = new Set([
  "attendance",
  "enrollment",
  "compliance",
  "broadcasts",
  "billing",
]);

export async function grantDelegationAction(
  _prev: DelegationActionState,
  formData: FormData,
): Promise<DelegationActionState> {
  const delegateProfileId = str(formData, "delegate_profile_id");
  const accessLevel = str(formData, "access_level");
  const endsOn = str(formData, "ends_on");
  const areas = [...new Set(formData.getAll("areas").map(String))].filter((area) =>
    DELEGATION_AREAS.has(area),
  );

  if (!UUID.test(delegateProfileId)) return { error: "Choose a staff member." };
  if (!['specific_areas', 'full_admin'].includes(accessLevel)) {
    return { error: "Choose an access level." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return { error: "Choose an expiry date." };
  if (accessLevel === "specific_areas" && areas.length === 0) {
    return { error: "Select at least one area." };
  }

  const endsAt = new Date(`${endsOn}T23:59:59.999Z`);
  if (Number.isNaN(endsAt.getTime()) || endsAt <= new Date()) {
    return { error: "The expiry must be in the future." };
  }

  try {
    const supabase = await getServerSupabase();
    await grantStaffDelegation(supabase, {
      delegateProfileId,
      accessLevel: accessLevel as "specific_areas" | "full_admin",
      areas: accessLevel === "specific_areas" ? areas : [],
      endsAt: endsAt.toISOString(),
    });
    revalidatePath("/staff");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not grant access." };
  }
}

export async function revokeDelegationAction(
  _prev: DelegationActionState,
  formData: FormData,
): Promise<DelegationActionState> {
  const delegationId = str(formData, "delegation_id");
  if (!UUID.test(delegationId)) return { error: "Invalid delegation." };

  try {
    const supabase = await getServerSupabase();
    await revokeStaffDelegation(supabase, delegationId);
    revalidatePath("/staff");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not revoke access." };
  }
}

export async function updateStaffAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const supabase = await getServerSupabase();
  const staffId = str(formData, "staff_id");

  // Certification rows arrive as parallel field arrays from the 4i editor.
  const items = formData.getAll("cert_item").map(String);
  const issuers = formData.getAll("cert_issuer").map(String);
  const issued = formData.getAll("cert_issued").map(String);
  const expires = formData.getAll("cert_expires").map(String);
  const certifications = items
    .map((item, i) => ({
      item: item.trim(),
      issuer: issuers[i]?.trim() || null,
      issued: issued[i]?.trim() || null,
      expires_on: expires[i]?.trim() || null,
    }))
    .filter((c) => c.item);
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const scheduleClassroomId = str(formData, "schedule_classroom_id");
  if (scheduleClassroomId && !UUID.test(scheduleClassroomId)) {
    return { error: "The educator's assigned room is invalid." };
  }
  const schedule: Array<{
    weekday: number;
    starts_local: string;
    ends_local: string;
    unpaid_break_minutes: number;
    classroom_id: string | null;
  }> = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    if (str(formData, `schedule_enabled_${weekday}`) !== "1") continue;
    const startsLocal = str(formData, `schedule_start_${weekday}`);
    const endsLocal = str(formData, `schedule_end_${weekday}`);
    const breakMinutes = Number(str(formData, `schedule_break_${weekday}`) || "0");
    if (!timePattern.test(startsLocal) || !timePattern.test(endsLocal) || endsLocal <= startsLocal) {
      return { error: "Every enabled schedule day needs an end time after its start time." };
    }
    const shiftMinutes = (
      Number(endsLocal.slice(0, 2)) * 60 + Number(endsLocal.slice(3, 5))
      - Number(startsLocal.slice(0, 2)) * 60 - Number(startsLocal.slice(3, 5))
    );
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= shiftMinutes) {
      return { error: "Each unpaid break must be shorter than that day's shift." };
    }
    schedule.push({
      weekday,
      starts_local: startsLocal,
      ends_local: endsLocal,
      unpaid_break_minutes: breakMinutes,
      classroom_id: scheduleClassroomId || null,
    });
  }

  try {
    await updateStaffMember(supabase, staffId, {
      job_title: str(formData, "job_title") || null,
      employment_type: str(formData, "employment_type") || null,
      started_on: str(formData, "started_on") || null,
    });
    const { error: credentialError } = await supabase.rpc(
      "replace_admin_staff_credentials",
      { p_staff_member_id: staffId, p_credentials: certifications },
    );
    if (credentialError) throw credentialError;
    const { error: scheduleError } = await supabase.rpc("save_staff_regular_schedule", {
      p_staff_member_id: staffId,
      p_schedule: schedule,
    });
    if (scheduleError) throw scheduleError;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save changes." };
  }

  revalidatePath(`/staff/${staffId}`);
  revalidatePath("/staff");
  return { ok: true };
}

export async function reviewCredentialSubmissionAction(
  _prev: CredentialReviewActionState,
  formData: FormData,
): Promise<CredentialReviewActionState> {
  const submissionId = str(formData, "submission_id");
  const decision = str(formData, "decision");
  const reviewNotes = str(formData, "review_notes");

  if (!UUID.test(submissionId)) return { error: "Invalid credential submission." };
  if (!['approved', 'rejected'].includes(decision)) {
    return { error: "Choose approve or request changes." };
  }
  if (decision === 'rejected' && !reviewNotes) {
    return { error: "Add a note explaining what the educator needs to correct." };
  }

  try {
    const { supabase } = await requireStaffPermission("approve");
    const { error } = await supabase.rpc("review_staff_credential_submission", {
      p_submission_id: submissionId,
      p_decision: decision,
      ...(reviewNotes ? { p_review_notes: reviewNotes } : {}),
    });
    if (error) throw error;
    revalidatePath("/staff");
    revalidatePath("/compliance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not review the renewal.",
    };
  }
}

export async function deactivateStaffAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await updateStaffMember(supabase, str(formData, "staff_id"), {
    status: "inactive",
    ended_on: new Date().toISOString().slice(0, 10),
  });
  revalidatePath("/staff");
}

const STAFF_DOCUMENT_CATEGORIES = new Set([
  "staff_private_contract",
  "staff_private_emergency",
  "staff_private_review",
  "staff_private_other",
]);

export async function uploadStaffDocumentAction(
  _prev: StaffDocumentActionState,
  formData: FormData,
): Promise<StaffDocumentActionState> {
  const staffId = str(formData, "staff_id");
  const category = str(formData, "category");
  const title = str(formData, "title");
  const file = formData.get("file");
  if (!UUID.test(staffId)) return { error: "Invalid staff record." };
  if (!STAFF_DOCUMENT_CATEGORIES.has(category)) return { error: "Choose a document type." };
  if (title.length < 2) return { error: "Add a document title." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > 10 * 1024 * 1024) return { error: "Documents must be 10 MB or smaller." };
  if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
    return { error: "Upload a PDF or image document." };
  }

  try {
    const supabase = await getServerSupabase();
    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id || profile.role !== "owner_admin") {
      return { error: "Only the owner admin can manage private staff documents." };
    }
    const { data: member, error: memberError } = await supabase
      .from("staff_members")
      .select("id, profile_id, daycare_id")
      .eq("id", staffId)
      .eq("daycare_id", profile.daycare_id)
      .single();
    if (memberError) throw memberError;
    if (!member.profile_id) throw new Error("This staff record is not linked to an account.");
    const subjectProfileId = member.profile_id;

    const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    const path = `staff-private/${subjectProfileId}/${category}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { error: archiveError } = await supabase
      .from("documents")
      .update({ archived_at: new Date().toISOString() })
      .eq("profile_id", subjectProfileId)
      .eq("category", category)
      .is("archived_at", null);
    if (archiveError) {
      await supabase.storage.from("documents").remove([path]);
      throw archiveError;
    }

    const { error: documentError } = await supabase.from("documents").insert({
      daycare_id: profile.daycare_id,
      profile_id: subjectProfileId,
      title: title.slice(0, 160),
      category,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: profile.id,
    });
    if (documentError) {
      await supabase.storage.from("documents").remove([path]);
      throw documentError;
    }

    revalidatePath(`/staff/${staffId}`);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not upload the document." };
  }
}

export async function archiveStaffDocumentAction(formData: FormData): Promise<void> {
  const staffId = str(formData, "staff_id");
  const documentId = str(formData, "document_id");
  if (!UUID.test(staffId) || !UUID.test(documentId)) return;
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id || profile.role !== "owner_admin") return;
  await supabase
    .from("documents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("daycare_id", profile.daycare_id)
    .like("category", "staff_private_%");
  revalidatePath(`/staff/${staffId}`);
}

export async function approveTimeEntriesAction(
  entryIds: string[],
): Promise<TimekeepingActionState> {
  try {
    const uniqueIds = [...new Set(entryIds)].filter((id) => UUID.test(id)).slice(0, 100);
    if (uniqueIds.length === 0) return { error: "No reviewable time entries were selected." };
    const { supabase } = await requireStaffPermission("approve");
    for (const entryId of uniqueIds) {
      const { error } = await supabase.rpc("approve_time_entry", {
        p_entry_id: entryId,
        p_approved: true,
      });
      if (error) throw error;
    }
    revalidatePath("/staff");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not approve timesheets." };
  }
}

export async function fixTimeEntryAction(input: {
  entryId: string;
  clockedOutAt: string;
  breakMinutes: number;
  notes?: string;
}): Promise<TimekeepingActionState> {
  try {
    if (!UUID.test(input.entryId)) return { error: "Invalid time entry." };
    const clockedOutAt = new Date(input.clockedOutAt);
    if (Number.isNaN(clockedOutAt.getTime())) return { error: "Enter a valid clock-out time." };
    const breakMinutes = Math.trunc(input.breakMinutes);
    if (breakMinutes < 0 || breakMinutes > 720) return { error: "Break must be between 0 and 720 minutes." };

    const { supabase } = await requireStaffPermission("edit");
    const { data: entry, error: readError } = await supabase
      .from("staff_time_entries")
      .select("id, clocked_in_at, status")
      .eq("id", input.entryId)
      .single();
    if (readError) throw readError;
    if (entry.status !== "open") return { error: "Only an open clock entry can be fixed." };
    if (clockedOutAt <= new Date(entry.clocked_in_at)) {
      return { error: "Clock-out must be after clock-in." };
    }
    const elapsedMinutes = (clockedOutAt.getTime() - new Date(entry.clocked_in_at).getTime()) / 60000;
    if (breakMinutes >= elapsedMinutes) return { error: "Break must be shorter than the shift." };

    const note = input.notes?.trim().slice(0, 1000) || null;
    const { error } = await supabase
      .from("staff_time_entries")
      .update({
        clocked_out_at: clockedOutAt.toISOString(),
        break_minutes: breakMinutes,
        status: "submitted",
        notes: note,
      })
      .eq("id", input.entryId)
      .eq("status", "open");
    if (error) throw error;
    revalidatePath("/staff");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not fix the time entry." };
  }
}

export async function reviewTimeOffAction(input: {
  requestId: string;
  decision: "approved" | "declined";
  notes?: string;
}): Promise<TimekeepingActionState> {
  try {
    if (!UUID.test(input.requestId)) return { error: "Invalid time-off request." };
    const { supabase, profile } = await requireStaffPermission("approve");
    const { data, error } = await supabase
      .from("staff_time_off_requests")
      .update({
        status: input.decision,
        decision_notes: input.notes?.trim().slice(0, 1000) || null,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", input.requestId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: "This request is no longer pending." };
    revalidatePath("/staff");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not review time off." };
  }
}
