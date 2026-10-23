import { createHash } from "node:crypto";
import { getMyProfile, hasPermission } from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response("Export not found", { status: 404 });
  }

  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile || !isAdminRole(profile.role) || !await hasPermission(supabase, "reports", "view")) {
    return new Response("Reports permission required", { status: 403 });
  }

  const { data: exportRow, error } = await supabase
    .from("report_exports")
    .select("id,daycare_id,report_kind,starts_on,ends_on,format,storage_path,content_sha256,content_bytes")
    .eq("id", id)
    .maybeSingle();
  if (error || !exportRow || exportRow.daycare_id !== profile.daycare_id) {
    return new Response("Export not found", { status: 404 });
  }
  if (exportRow.format !== "csv" && exportRow.format !== "pdf") {
    return new Response("Unsupported export format", { status: 404 });
  }
  const expectedPath = `${exportRow.daycare_id}/${exportRow.id}.${exportRow.format}`;
  if (exportRow.storage_path !== expectedPath
    || !exportRow.content_sha256 || exportRow.content_bytes === null) {
    return new Response("This historical export has no saved file", { status: 404 });
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from("report-exports")
    .download(expectedPath);
  if (downloadError || !file) return new Response("Saved export unavailable", { status: 503 });
  const body = await file.arrayBuffer();
  const hash = createHash("sha256").update(new Uint8Array(body)).digest("hex");
  if (body.byteLength !== exportRow.content_bytes || hash !== exportRow.content_sha256) {
    return new Response("Saved export failed its integrity check", { status: 503 });
  }

  const dates = [exportRow.starts_on, exportRow.ends_on].filter(Boolean).join("-to-");
  const safeKind = exportRow.report_kind.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const filename = `${safeKind}${dates ? `-${dates}` : ""}-${exportRow.id.slice(0, 8)}.${exportRow.format}`;
  return new Response(body, {
    headers: {
      "Content-Type": exportRow.format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
