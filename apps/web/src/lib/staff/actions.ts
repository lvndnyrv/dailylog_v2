"use server";

import {
  inviteStaff,
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
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function inviteStaffAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const supabase = await getServerSupabase();

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
    revalidatePath("/staff");
    return { ok: true, inviteLink: `${origin}/invite?code=${code}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the invite." };
  }
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await revokeStaffInvite(supabase, str(formData, "invite_id"));
  revalidatePath("/staff");
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
