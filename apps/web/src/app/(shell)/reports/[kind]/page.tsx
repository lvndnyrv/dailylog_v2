import { notFound } from "next/navigation";
import { getMyDaycare, getMyProfile, hasPermission } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { ReportViewer } from "@/components/reports/report-viewer";
import { getServerSupabase } from "@/lib/supabase/server";
import { isDate } from "@/lib/center-date";
import { defaultReportRange, getReportPreview } from "@/lib/reports/data";
import { isReportKind } from "@/lib/reports/catalog";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ kind }, query] = await Promise.all([params, searchParams]);
  if (!isReportKind(kind)) notFound();
  const client = await getServerSupabase();
  const [profile, daycare, canView] = await Promise.all([
    getMyProfile(client),
    getMyDaycare(client),
    hasPermission(client, "reports", "view"),
  ]);
  if (!profile?.daycare_id || !["owner_admin", "admin"].includes(profile.role) || !canView) {
    return (
      <>
        <SectionHeader title="Reports" subtitle="Center reporting and exports" showUtilities={false} />
        <main className="p-7 text-sm text-muted">Reports viewing permission is required.</main>
      </>
    );
  }
  const timeZone = daycare?.timezone ?? "America/Toronto";
  const defaults = defaultReportRange(timeZone);
  const startsOn = isDate(query.from) ? query.from : defaults.startsOn;
  const endsOn = isDate(query.to) ? query.to : defaults.endsOn;
  const safeStart = startsOn <= endsOn ? startsOn : endsOn;
  const safeEnd = startsOn <= endsOn ? endsOn : startsOn;
  const preview = await getReportPreview(client, kind, safeStart, safeEnd, timeZone);
  return (
    <>
      <SectionHeader title={preview.title} subtitle={`${safeStart} through ${safeEnd}`} showUtilities={false} />
      <ReportViewer preview={preview} />
    </>
  );
}
