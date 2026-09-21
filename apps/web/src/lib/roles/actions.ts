"use server";

import {
  createCenterRole,
  deleteCenterRole,
  getMyProfile,
  updateCenterRole,
} from "@dailylog/db/queries";
import {
  PERMISSION_AREA_KEYS,
  emptyPermission,
  type RolePermissions,
} from "@dailylog/shared";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface RoleActionState {
  error?: string;
  ok?: boolean;
  newRoleId?: string;
}

export interface PermissionOverrideActionState {
  error?: string;
  ok?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// The matrix posts one hidden input per area/column, e.g. perm_daily_logs_view.
function readPermissions(formData: FormData): RolePermissions {
  const perms: RolePermissions = {};
  for (const key of PERMISSION_AREA_KEYS) {
    perms[key] = {
      view: formData.get(`perm_${key}_view`) === "1",
      edit: formData.get(`perm_${key}_edit`) === "1",
      approve: formData.get(`perm_${key}_approve`) === "1",
    };
  }
  return perms;
}

export async function saveRoleAction(
  _prev: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const supabase = await getServerSupabase();
  const id = str(formData, "role_id");
  const name = str(formData, "name");
  if (!name) return { error: "A role name is required." };

  try {
    await updateCenterRole(supabase, id, {
      name,
      description: str(formData, "description") || null,
      permissions: readPermissions(formData),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the role." };
  }

  revalidatePath("/staff");
  return { ok: true };
}

export async function createRoleAction(
  _prev: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const name = str(formData, "name");
  if (!name) return { error: "Name the new role." };

  // A blank custom role starts with view-only on care areas, nothing else.
  const permissions: RolePermissions = {};
  for (const key of PERMISSION_AREA_KEYS) permissions[key] = emptyPermission();

  try {
    const newRoleId = await createCenterRole(supabase, {
      daycare_id: profile.daycare_id,
      name,
      description: str(formData, "description") || null,
      base_role: "educator",
      permissions,
    });
    revalidatePath("/staff");
    return { ok: true, newRoleId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the role." };
  }
}

// Duplicate carries the source role's matrix into a new "<name> copy".
export async function duplicateRoleAction(
  _prev: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const name = str(formData, "name");
  let permissions: RolePermissions;
  try {
    permissions = JSON.parse(str(formData, "permissions") || "{}");
  } catch {
    permissions = {};
  }

  try {
    const newRoleId = await createCenterRole(supabase, {
      daycare_id: profile.daycare_id,
      name,
      description: str(formData, "description") || null,
      base_role: str(formData, "base_role") || "educator",
      permissions,
    });
    revalidatePath("/staff");
    return { ok: true, newRoleId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not duplicate the role." };
  }
}

export async function deleteRoleAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await deleteCenterRole(supabase, str(formData, "role_id"));
  revalidatePath("/staff");
}

export async function saveStaffPermissionOverrideAction(
  _prev: PermissionOverrideActionState,
  formData: FormData,
): Promise<PermissionOverrideActionState> {
  const supabase = await getServerSupabase();
  const profileId = str(formData, "profile_id");
  const staffId = str(formData, "staff_id");
  const classroomId = str(formData, "classroom_id") || null;
  let permissions: unknown = {};

  if (str(formData, "intent") !== "reset") {
    try {
      permissions = JSON.parse(str(formData, "permissions") || "{}");
    } catch {
      return { error: "The permission changes could not be read." };
    }
  }

  const { error } = await supabase.rpc(
    "save_staff_permission_override" as never,
    {
      p_profile_id: profileId,
      p_classroom_id: classroomId,
      p_permissions: permissions,
    } as never,
  );
  if (error) return { error: error.message };

  revalidatePath("/staff");
  if (staffId) revalidatePath(`/staff/${staffId}`);
  return { ok: true };
}
