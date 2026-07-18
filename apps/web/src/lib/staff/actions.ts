"use server";

import {
  hasPermission,
  enqueueEmailNotification,
  getMyProfile,
  grantStaffDelegation,
  inviteStaff,
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
}

export interface TimekeepingActionState {
  error?: string;
  ok?: boolean;
}

export interface DelegationActionState {
  error?: string;
  ok?: boolean;
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

  try {
    await updateStaffMember(supabase, staffId, {
      job_title: str(formData, "job_title") || null,
      employment_type: str(formData, "employment_type") || null,
      started_on: str(formData, "started_on") || null,
      certifications,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save changes." };
  }

  revalidatePath(`/staff/${staffId}`);
  revalidatePath("/staff");
  return { ok: true };
}

export async function deactivateStaffAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await updateStaffMember(supabase, str(formData, "staff_id"), {
    status: "inactive",
    ended_on: new Date().toISOString().slice(0, 10),
  });
  revalidatePath("/staff");
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
        p_notes: null,
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
      .single();
    if (error) throw error;
    if (!data) return { error: "This request is no longer pending." };
    revalidatePath("/staff");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not review time off." };
  }
}
