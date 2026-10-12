"use server";

import { getMyProfile, hasPermission } from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { isReportKind, REPORT_CATALOG, type ReportKind } from "./catalog";

export interface ReportActionResult {
  ok?: boolean;
  error?: string;
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const errorMessage = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "The report setting could not be saved.";

async function reportClient(action: "view" | "edit") {
  const client = await getServerSupabase();
  const profile = await getMyProfile(client);
  if (
    !profile?.daycare_id ||
    !["owner_admin", "admin"].includes(profile.role) ||
    !(await hasPermission(client, "reports", action))
  )
    throw new Error(`Reports ${action} permission required.`);
  return { client, profile, daycareId: profile.daycare_id };
}

export async function saveReportSchedule(form: FormData): Promise<ReportActionResult> {
  try {
    const { client, profile, daycareId } = await reportClient("edit");
    const kind = text(form, "report_kind");
    const cadence = text(form, "cadence");
    const deliveryDay = Number(text(form, "delivery_day"));
    const deliveryTime = text(form, "delivery_time");
    const recipients = form
      .getAll("recipient_ids")
      .map(String)
      .filter(Boolean);
    const formats = form.getAll("formats").map(String).filter(Boolean);
    if (!isReportKind(kind)) return { error: "Choose a valid report." };
    if (!["weekly", "monthly", "quarterly"].includes(cadence))
      return { error: "Choose a valid cadence." };
    if (!Number.isInteger(deliveryDay)) return { error: "Choose a delivery day." };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime))
      return { error: "Choose a valid delivery time." };
    if (!recipients.length) return { error: "Choose at least one administrator." };
    if (!formats.length || formats.some((format) => !["pdf", "csv"].includes(format)))
      return { error: "Choose PDF, CSV, or both." };
    const values = {
      daycare_id: daycareId,
      created_by: profile.id,
      report_kind: kind,
      cadence,
      delivery_day: deliveryDay,
      delivery_time: deliveryTime,
      recipient_ids: recipients,
      formats,
      skip_empty: form.get("skip_empty") === "on",
      active: true,
    };
    const id = text(form, "id");
    const query = id
      ? client.from("report_schedules").update(values).eq("id", id)
      : client.from("report_schedules").insert(values);
    const { error } = await query;
    if (error) throw error;
    revalidatePath("/reports", "layout");
    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function setReportScheduleActive(
  id: string,
  active: boolean,
): Promise<ReportActionResult> {
  try {
    const { client } = await reportClient("edit");
    const { error } = await client.from("report_schedules").update({ active }).eq("id", id);
    if (error) throw error;
    revalidatePath("/reports", "layout");
    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function deleteReportSchedule(id: string): Promise<ReportActionResult> {
  try {
    const { client } = await reportClient("edit");
    const { error } = await client.from("report_schedules").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/reports", "layout");
    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function recordReportExport(
  kind: ReportKind,
  format: "pdf" | "csv",
  startsOn: string,
  endsOn: string,
  rowCount: number,
): Promise<ReportActionResult> {
  try {
    const { client, profile, daycareId } = await reportClient("view");
    const { error } = await client.from("report_exports").insert({
      daycare_id: daycareId,
      created_by: profile.id,
      report_kind: kind,
      title: REPORT_CATALOG[kind].title,
      starts_on: startsOn,
      ends_on: endsOn,
      format,
      row_count: rowCount,
      parameters: { starts_on: startsOn, ends_on: endsOn },
    });
    if (error) throw error;
    revalidatePath("/reports");
    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
