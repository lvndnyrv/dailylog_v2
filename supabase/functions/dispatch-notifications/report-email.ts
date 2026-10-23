const reportKinds = new Set([
  'attendance', 'billing', 'ratio', 'timesheets', 'incidents', 'enrollment',
]);

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function scheduledReportLink(
  payload: Record<string, unknown>,
  appUrl: string | undefined,
): string | null {
  if (payload.type !== 'scheduled_report' || !appUrl) return null;
  const { reportKind, startsOn, endsOn } = payload;
  if (typeof reportKind !== 'string' || !reportKinds.has(reportKind)
    || !validDate(startsOn) || !validDate(endsOn) || startsOn > endsOn) return null;

  try {
    const configured = new URL(appUrl);
    if (configured.protocol !== 'https:' || configured.username || configured.password) return null;
    const link = new URL(`/reports/${reportKind}`, configured.origin);
    link.searchParams.set('from', startsOn);
    link.searchParams.set('to', endsOn);
    return link.toString();
  } catch {
    return null;
  }
}

export function scheduledReportEmailText(
  body: string | null,
  payload: Record<string, unknown>,
  appUrl: string | undefined,
): string {
  if (payload.type !== 'scheduled_report') return body ?? '';
  const link = scheduledReportLink(payload, appUrl);
  return `${body ?? ''}\n\n${link
    ? `Open the report in DailyLog: ${link}`
    : 'Sign in to DailyLog and open Reports to view this period.'}`;
}
