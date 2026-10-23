import { getMyDaycare, getMyProfile, hasPermission } from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { isDate } from "@/lib/center-date";
import { getServerSupabase } from "@/lib/supabase/server";
import { archiveReport, ReportArchiveTooLargeError } from "@/lib/reports/archive";
import { getReportPreview } from "@/lib/reports/data";
import { isReportKind } from "@/lib/reports/catalog";
import { renderReportPdf, UnsupportedReportGlyphError } from "@/lib/reports/pdf";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!isReportKind(kind)) return new Response("Unknown report", { status: 404 });
  const url = new URL(request.url);
  const startsOn = url.searchParams.get("from");
  const endsOn = url.searchParams.get("to");
  if (!isDate(startsOn ?? undefined) || !isDate(endsOn ?? undefined) || startsOn! > endsOn!) {
    return new Response("Choose a valid report period", { status: 400 });
  }

  const client = await getServerSupabase();
  const [profile, daycare, allowed] = await Promise.all([
    getMyProfile(client),
    getMyDaycare(client),
    hasPermission(client, "reports", "view"),
  ]);
  if (!profile?.daycare_id || !isAdminRole(profile.role) || !allowed) {
    return new Response("Reports permission required", { status: 403 });
  }

  try {
    const preview = await getReportPreview(client, kind, startsOn!, endsOn!, daycare?.timezone ?? "America/Toronto", profile.daycare_id);
    if (preview.exportBlockedReason) {
      return new Response(preview.exportBlockedReason, { status: 409 });
    }
    const bytes = await renderReportPdf(preview, daycare?.name ?? "Childcare center");
    await archiveReport(client, {
      daycareId: profile.daycare_id,
      profileId: profile.id,
      kind,
      format: "pdf",
      startsOn: preview.startsOn,
      endsOn: preview.endsOn,
      rowCount: preview.rowCount,
      parameters: { from: preview.startsOn, to: preview.endsOn },
      bytes,
    });
    const body = Uint8Array.from(bytes).buffer as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${kind}-${preview.startsOn}-to-${preview.endsOn}.pdf"`,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return error instanceof ReportArchiveTooLargeError
      ? new Response(error.message, { status: 413 })
      : error instanceof UnsupportedReportGlyphError
      ? new Response(error.message, { status: 422 })
      : new Response("Report PDF is temporarily unavailable", { status: 500 });
  }
}
