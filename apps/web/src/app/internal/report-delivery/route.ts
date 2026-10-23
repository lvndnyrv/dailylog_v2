import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@dailylog/db";
import { isDate } from "@/lib/center-date";
import { csvRows } from "@/lib/csv";
import { archiveReport, ReportArchiveTooLargeError } from "@/lib/reports/archive";
import { isReportKind, type ReportKind } from "@/lib/reports/catalog";
import { getReportPreview } from "@/lib/reports/data";
import { renderReportPdf, UnsupportedReportGlyphError } from "@/lib/reports/pdf";

export const runtime = "nodejs";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DEDUPE = new RegExp(`^report-schedule:(${UUID}):(\\d{4}-\\d{2}-\\d{2}):(\\d{4}-\\d{2}-\\d{2}):(${UUID})$`, "i");
const MAX_EMAIL_FILE_BYTES = 10 * 1024 * 1024;
type Client = ReturnType<typeof createClient<Database>>;
type Format = "pdf" | "csv";
type SavedFile = { id: string; bytes: Uint8Array };

function authorized(request: Request): boolean {
  const expected = process.env.REPORT_DELIVERY_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  if (!expected || expected.length < 32) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function savedFile(
  client: Client,
  input: { daycareId: string; scheduleId: string; kind: ReportKind; startsOn: string; endsOn: string; format: Format },
) {
  const { data, error } = await client.from("report_exports")
    .select("id,storage_path,content_sha256,content_bytes")
    .eq("daycare_id", input.daycareId)
    .eq("report_kind", input.kind)
    .eq("starts_on", input.startsOn)
    .eq("ends_on", input.endsOn)
    .eq("format", input.format)
    .contains("parameters", { scheduled: true, schedule_id: input.scheduleId })
    .not("storage_path", "is", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const expectedPath = `${input.daycareId}/${data.id}.${input.format}`;
  if (data.storage_path !== expectedPath || !data.content_sha256 || data.content_bytes === null) {
    throw new Error("Scheduled report archive metadata failed validation");
  }
  const { data: file, error: downloadError } = await client.storage.from("report-exports").download(expectedPath);
  if (downloadError || !file) throw new Error("Scheduled report archive is unavailable");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== data.content_bytes
    || createHash("sha256").update(bytes).digest("hex") !== data.content_sha256) {
    throw new Error("Scheduled report archive failed its integrity check");
  }
  return { id: data.id, bytes } satisfies SavedFile;
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Response("Report delivery is not configured", { status: 503 });

  let outboxId: string;
  try {
    const body = await request.json() as { outboxId?: unknown };
    if (typeof body.outboxId !== "string" || !new RegExp(`^${UUID}$`, "i").test(body.outboxId)) {
      return new Response("Invalid delivery", { status: 400 });
    }
    outboxId = body.outboxId;
  } catch {
    return new Response("Invalid delivery", { status: 400 });
  }

  const client = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: delivery, error: deliveryError } = await client.from("notification_outbox")
    .select("id,daycare_id,recipient_id,kind,channel,status,dedupe_key,payload")
    .eq("id", outboxId).maybeSingle();
  if (deliveryError || !delivery || delivery.kind !== "scheduled_report"
    || delivery.channel !== "email" || delivery.status !== "processing" || !delivery.recipient_id) {
    return new Response("Delivery not found", { status: 404 });
  }
  const match = DEDUPE.exec(delivery.dedupe_key);
  const payload = delivery.payload && typeof delivery.payload === "object" && !Array.isArray(delivery.payload)
    ? delivery.payload : null;
  const kind = payload?.reportKind;
  const startsOn = payload?.startsOn;
  const endsOn = payload?.endsOn;
  const formats = payload?.formats;
  if (!match || match[4] !== delivery.recipient_id || !isReportKind(kind as string)
    || !isDate(startsOn as string) || !isDate(endsOn as string)
    || startsOn! > endsOn! || match[2] !== startsOn || match[3] !== endsOn
    || !Array.isArray(formats) || !formats.length
    || formats.some((format) => format !== "csv" && format !== "pdf")) {
    return new Response("Invalid scheduled delivery", { status: 422 });
  }
  const scheduleId = match[1];
  const [scheduleResult, recipientResult, daycareResult] = await Promise.all([
    client.from("report_schedules").select("daycare_id,report_kind,active,recipient_ids,created_by")
      .eq("id", scheduleId).maybeSingle(),
    client.from("profiles").select("id,daycare_id,role,archived_at")
      .eq("id", delivery.recipient_id).maybeSingle(),
    client.from("daycares").select("id,name,timezone")
      .eq("id", delivery.daycare_id).maybeSingle(),
  ]);
  const schedule = scheduleResult.data;
  const recipient = recipientResult.data;
  const daycare = daycareResult.data;
  if (scheduleResult.error || recipientResult.error || daycareResult.error
    || !schedule || !recipient || !daycare || !schedule.active
    || schedule.daycare_id !== delivery.daycare_id || schedule.report_kind !== kind
    || !schedule.recipient_ids.includes(delivery.recipient_id)
    || recipient.daycare_id !== delivery.daycare_id
    || !["owner_admin", "admin"].includes(recipient.role) || recipient.archived_at) {
    return new Response("Scheduled delivery is no longer authorized", { status: 403 });
  }

  try {
    const reportKind = kind as ReportKind;
    const start = startsOn as string;
    const end = endsOn as string;
    const requestedFormats = [...new Set(formats)] as Format[];
    const existing = await Promise.all(requestedFormats.map((format) => savedFile(client, {
      daycareId: delivery.daycare_id, scheduleId, kind: reportKind, startsOn: start, endsOn: end, format,
    })));
    const preview = existing.every(Boolean) ? null : await getReportPreview(
      client, reportKind, start, end, daycare.timezone ?? "America/Toronto", delivery.daycare_id,
    );
    if (preview?.exportBlockedReason) return new Response(preview.exportBlockedReason, { status: 409 });
    const files = [];
    let attachmentBudget = MAX_EMAIL_FILE_BYTES;
    for (const [index, format] of requestedFormats.entries()) {
      let saved: SavedFile | null = existing[index];
      if (!saved) {
        const bytes = format === "pdf"
          ? await renderReportPdf(preview!, daycare.name)
          : new TextEncoder().encode("\uFEFF" + csvRows([preview!.columns, ...preview!.rows]));
        try {
          const id = await archiveReport(client, {
            daycareId: delivery.daycare_id,
            profileId: schedule.created_by,
            kind: reportKind,
            format,
            startsOn: start,
            endsOn: end,
            rowCount: preview!.rowCount,
            parameters: { scheduled: true, schedule_id: scheduleId, from: start, to: end },
            bytes,
          });
          saved = { id, bytes };
        } catch (error) {
          // A concurrent recipient may have archived the same file first.
          saved = await savedFile(client, {
            daycareId: delivery.daycare_id, scheduleId, kind: reportKind, startsOn: start, endsOn: end, format,
          });
          if (!saved) throw error;
        }
      }
      if (!saved) throw new Error("Scheduled report archive is unavailable");
      const filename = `${reportKind}-${start}-to-${end}.${format}`;
      const attach = saved.bytes.byteLength <= attachmentBudget;
      if (attach) attachmentBudget -= saved.bytes.byteLength;
      files.push({
        id: saved.id,
        filename,
        contentType: format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
        bytes: saved.bytes.byteLength,
        contentBase64: attach
          ? Buffer.from(saved.bytes).toString("base64") : null,
      });
    }
    return Response.json({ files }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReportArchiveTooLargeError) {
      return new Response(error.message, { status: 413 });
    }
    if (error instanceof UnsupportedReportGlyphError) {
      return new Response(error.message, { status: 422 });
    }
    return new Response("Scheduled report generation failed", { status: 503 });
  }
}
