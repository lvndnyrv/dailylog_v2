import { SectionHeader } from "@/components/shell/header";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";

const REPORTS = [
  {
    title: "Daily attendance record",
    blurb: "Who was in, when, and who dropped off — the licensing record for any day.",
    href: "/reports-export/attendance",
    note: "today's date · add ?date=YYYY-MM-DD for another day",
  },
  {
    title: "Children roster",
    blurb: "Every active child with room, birthday, allergies and primary contact.",
    href: "/reports-export/children",
    note: "one row per child",
  },
  {
    title: "Invoices",
    blurb: "Every invoice with family, status and totals — ready for the accountant.",
    href: "/reports-export/invoices",
    note: "one row per invoice",
  },
];

// Reports 13a — the library. Each report is a CSV export scoped by RLS.
// Scheduling (13c/13d) and the timesheet export (13e) arrive with their
// underlying features.
export default function ReportsPage() {
  return (
    <>
      <SectionHeader
        title="Reports"
        subtitle="Run and export — everything is scoped to your center"
      />
      <div className="grid flex-1 grid-cols-3 items-start gap-4 p-7">
        {REPORTS.map((report) => (
          <div key={report.title} className={`${card} flex flex-col gap-2`}>
            <h2 className="text-[14px] font-extrabold text-ink">{report.title}</h2>
            <p className="flex-1 text-[12.5px] leading-relaxed text-muted">{report.blurb}</p>
            <p className="text-[10.5px] text-faint">{report.note}</p>
            <a
              href={report.href}
              className="self-start rounded-btn bg-primary px-4 py-2 text-[13px] font-bold text-white hover:bg-primary-hover"
            >
              Download CSV
            </a>
          </div>
        ))}
        <div className={`${card} col-span-3 opacity-70`}>
          <h2 className="text-[14px] font-extrabold text-ink">Scheduled reports & timesheets</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            Emailing reports on a cadence (13c) needs the email provider decision;
            the payroll timesheet export (13e) needs staff clock-ins. Both are
            logged in DECISIONS.md.
          </p>
        </div>
      </div>
    </>
  );
}
