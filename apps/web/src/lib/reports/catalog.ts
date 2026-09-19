export const REPORT_KINDS = [
  "attendance",
  "billing",
  "ratio",
  "timesheets",
  "incidents",
  "enrollment",
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportDefinition {
  kind: ReportKind;
  title: string;
  description: string;
  csvKind: string;
  emptyHint: string;
}

export const REPORT_CATALOG: Record<ReportKind, ReportDefinition> = {
  attendance: {
    kind: "attendance",
    title: "Attendance summary",
    description:
      "Daily counts, absences and occupancy by room — the record licensing asks for.",
    csvKind: "attendance-summary",
    emptyHint: "Attendance appears after children are checked in or marked absent.",
  },
  billing: {
    kind: "billing",
    title: "Revenue & billing",
    description:
      "Collected, outstanding and invoice status — ready for your accountant.",
    csvKind: "invoices",
    emptyHint: "Billing activity appears after the first invoice is issued.",
  },
  ratio: {
    kind: "ratio",
    title: "Ratio compliance",
    description:
      "Auditable room coverage intervals with observed and over-ratio minutes.",
    csvKind: "ratio",
    emptyHint: "Ratio history begins while the center is open and attendance is active.",
  },
  timesheets: {
    kind: "timesheets",
    title: "Staff hours & timesheets",
    description:
      "Clock-ins, breaks and overtime — with an approval-safe payroll export.",
    csvKind: "timesheets",
    emptyHint: "Hours appear after staff clock in and complete a shift.",
  },
  incidents: {
    kind: "incidents",
    title: "Incident log",
    description:
      "Reports with sign-off, parent acknowledgement and follow-up status.",
    csvKind: "incidents",
    emptyHint: "Submitted incident reports appear here.",
  },
  enrollment: {
    kind: "enrollment",
    title: "Enrollment funnel",
    description:
      "Inquiries, tours, applications, offers and enrollments in one pipeline.",
    csvKind: "enrollment",
    emptyHint: "New family inquiries appear here as they enter the pipeline.",
  },
};

export function isReportKind(value: string): value is ReportKind {
  return REPORT_KINDS.includes(value as ReportKind);
}

export function reportTitle(kind: string): string {
  return isReportKind(kind) ? REPORT_CATALOG[kind].title : "Report";
}
