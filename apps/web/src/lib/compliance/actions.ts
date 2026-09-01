"use server";

import { getMyProfile } from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface ComplianceActionResult {
  error?: string;
  ok?: boolean;
  token?: string;
  expiresAt?: string;
}
const value = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const message = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Unable to save. Please try again.";
async function adminClient() {
  const client = await getServerSupabase();
  const profile = await getMyProfile(client);
  if (!profile?.daycare_id || !["owner_admin", "admin"].includes(profile.role))
    throw new Error("Administrator access required.");
  return { client, profile };
}
function refresh() {
  revalidatePath("/compliance", "layout");
}

export async function uploadComplianceDocument(
  form: FormData,
): Promise<ComplianceActionResult> {
  try {
    const { client, profile } = await adminClient();
    const file = form.get("file");
    const title = value(form, "title");
    if (!title) return { error: "Document title is required." };
    if (
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > 10 * 1024 * 1024
    )
      return { error: "Choose a file up to 10 MB." };
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isPdf = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every(
      (b, i) => bytes[i] === b,
    );
    const type = isPdf
      ? "application/pdf"
      : isJpeg
        ? "image/jpeg"
        : isPng
          ? "image/png"
          : null;
    if (!type) return { error: "Choose a valid PDF, JPEG or PNG file." };
    const watch = form.get("watch_expiry") === "on";
    const expiry = value(form, "expires_on");
    if (watch && !expiry)
      return { error: "Add an expiry date, or turn off expiry watching." };
    const path = `${profile.daycare_id}/${profile.id}/${crypto.randomUUID()}.${isPdf ? "pdf" : isJpeg ? "jpg" : "png"}`;
    const { error: uploadError } = await client.storage
      .from("compliance-vault")
      .upload(path, file, { contentType: type, upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await client.rpc("save_compliance_document", {
      p_title: title,
      p_category: value(form, "category"),
      p_storage_path: path,
      ...(expiry ? { p_expires_on: expiry } : {}),
      p_watch_expiry: watch,
      p_include_in_inspection: form.get("include_in_inspection") === "on",
      ...(value(form, "replaces_id")
        ? { p_replaces_id: value(form, "replaces_id") }
        : {}),
    });
    if (error) {
      await client.storage.from("compliance-vault").remove([path]);
      throw error;
    }
    refresh();
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function logComplianceDrill(
  form: FormData,
): Promise<ComplianceActionResult> {
  try {
    const { client } = await adminClient();
    const number = (key: string) =>
      value(form, key) === "" ? NaN : Number(value(form, key));
    const seconds = number("minutes") * 60 + number("seconds");
    if (
      ![seconds, number("children_count"), number("staff_count")].every(
        Number.isInteger,
      )
    )
      return { error: "Enter duration and both headcounts." };
    const { error } = await client.rpc("log_compliance_drill", {
      p_kind: value(form, "kind"),
      p_conducted_local: value(form, "conducted_local"),
      p_lead_staff_id: value(form, "lead_staff_id"),
      p_duration_seconds: seconds,
      p_children_count: number("children_count"),
      p_staff_count: number("staff_count"),
      p_notes: value(form, "notes"),
      ...(value(form, "next_due_on")
        ? { p_next_due_on: value(form, "next_due_on") }
        : {}),
    });
    if (error) throw error;
    refresh();
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function voidComplianceDrill(
  id: string,
  reason: string,
): Promise<ComplianceActionResult> {
  try {
    const { client } = await adminClient();
    const { error } = await client.rpc("void_compliance_drill", {
      p_id: id,
      p_reason: reason,
    });
    if (error) throw error;
    refresh();
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function createInspectionShare(
  label: string,
): Promise<ComplianceActionResult> {
  try {
    const { client } = await adminClient();
    const { data, error } = await client.rpc(
      "create_compliance_inspection_share",
      { p_label: label },
    );
    if (error) throw error;
    const share = data as { token: string; expires_at: string };
    refresh();
    return { ok: true, token: share.token, expiresAt: share.expires_at };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function revokeInspectionShare(
  id: string,
): Promise<ComplianceActionResult> {
  try {
    const { client } = await adminClient();
    const { error } = await client.rpc("revoke_compliance_inspection_share", {
      p_id: id,
    });
    if (error) throw error;
    refresh();
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}
