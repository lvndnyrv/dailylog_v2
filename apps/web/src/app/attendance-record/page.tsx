import { getMyDaycare, getMyProfile, hasPermission } from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { notFound, redirect } from "next/navigation";
import { addDateDays, dateInTimeZone } from "@/lib/center-date";
import {
  attendanceIntervalHours,
  loadMonthlyAttendanceRecords,
  nextAttendanceMonth,
} from "@/lib/attendance/monthly-record";
import { getServerSupabase } from "@/lib/supabase/server";
import { PrintButton } from "@/components/attendance/print-button";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AttendanceRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; child?: string }>;
}) {
  const query = await searchParams;
  if (query.child && !uuidPattern.test(query.child)) notFound();
  const client = await getServerSupabase();
  const [profile, center, canViewAttendance, canViewReports] = await Promise.all([
    getMyProfile(client),
    getMyDaycare(client),
    hasPermission(client, "attendance", "view"),
    hasPermission(client, "reports", "view"),
  ]);
  if (!isAdminRole(profile?.role)) redirect("/use-the-app");
  if (!canViewAttendance || !canViewReports) redirect("/reports");

  const timeZone = center?.timezone ?? "America/Toronto";
  const today = dateInTimeZone(new Date(), timeZone);
  const month = monthPattern.test(query.month ?? "") ? query.month! : today.slice(0, 7);
  const records = await loadMonthlyAttendanceRecords(client, month, query.child);
  if (query.child && records.length === 0) notFound();

  // Opening a print/PDF record is an export, even if browser printing is cancelled.
  if (profile?.daycare_id) {
    const { error } = await client.from("report_exports").insert({
      daycare_id: profile.daycare_id,
      created_by: profile.id,
      report_kind: "attendance",
      title: "Monthly attendance record",
      starts_on: `${month}-01`,
      ends_on: addDateDays(nextAttendanceMonth(month), -1),
      format: "pdf",
      row_count: records.reduce((total, record) => total + record.rows.length, 0),
      parameters: { month, ...(query.child ? { child: query.child } : {}) },
    });
    if (error) throw error;
  }

  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-CA", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
  const time = (timestamp: string | null) => timestamp
    ? new Date(timestamp).toLocaleTimeString("en-CA", {
      hour: "numeric", minute: "2-digit", timeZone,
    })
    : "—";
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });

  return (
    <main className="mx-auto max-w-[820px] bg-white px-8 py-8 font-sans text-ink print:max-w-none print:p-0">
      <style>{"@page { size: A4 portrait; margin: 14mm; }"}</style>
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <a href={query.child ? `/children/${query.child}` : "/reports/attendance"}
          className="text-[13px] font-bold text-primary">← Back</a>
        <span className="flex-1" />
        <form method="get" action="/attendance-record" className="flex items-center gap-2">
          {query.child && <input type="hidden" name="child" value={query.child} />}
          <label htmlFor="attendance-record-month" className="text-[12px] font-bold text-muted">Month</label>
          <input id="attendance-record-month" type="month" name="month" defaultValue={month}
            className="rounded-btn border border-[#D6E1F0] px-3 py-2 text-[13px] text-ink" />
          <button type="submit" className="rounded-btn border border-[#D6E1F0] px-3 py-2 text-[13px] font-bold text-primary">
            View
          </button>
        </form>
        <a href={`/reports-export/attendance-month?month=${month}${query.child ? `&child=${query.child}` : ""}`}
          className="rounded-btn border border-[#D6E1F0] px-4 py-2 text-[13px] font-bold text-primary">
          Download CSV
        </a>
        <PrintButton label="Print / Save PDF" />
      </div>
      {records.length === 0 && (
        <section className="rounded-xl border border-[#D6E1F0] p-8 text-center">
          <h1 className="text-xl font-extrabold">No attendance records for {monthLabel}</h1>
          <p className="mt-2 text-sm text-muted">Choose another month or check the child’s attendance history.</p>
        </section>
      )}
      {records.map((record) => (
        <article key={record.id} className="mb-10 break-after-page last:break-after-auto print:mb-0">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink pb-4">
            <span>
              <span className="block text-[13px] font-bold text-muted">{center?.name ?? "Your center"}</span>
              <h1 className="mt-1 text-[23px] font-extrabold">Attendance record — {record.name}</h1>
              <span className="mt-1 block text-[12px] text-muted">{monthLabel} · {record.room}</span>
            </span>
            <span className="text-right text-[10.5px] text-muted">
              Generated {new Date().toLocaleDateString("en-CA", { timeZone })}<br />
              Center-local time: {timeZone}
            </span>
          </header>
          <div className="my-5 grid grid-cols-3 gap-3">
            <Metric value={String(record.attendedDays)} label="Days attended" />
            <Metric value={String(record.absentDays)} label="Absent / excused" />
            <Metric value={record.averageHours === null ? "—" : record.averageHours.toFixed(1)} label="Average completed day (hours)" />
          </div>
          {record.absentDays > 0 && (
            <p className="mb-4 text-[11px] text-muted">
              Absences: {Object.entries(record.absenceReasons)
                .map(([reason, count]) => `${count} ${reason.toLowerCase()}`)
                .join(" · ")}
            </p>
          )}
          {record.incompleteDays > 0 && (
            <p className="mb-4 rounded-lg bg-[#FBF3E4] px-3 py-2 text-[11px] text-[#8B5E21]">
              {record.incompleteDays} checked-in day{record.incompleteDays === 1 ? " is" : "s are"} missing a check-out; these are excluded from the average until corrected.
            </p>
          )}
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-[#D6E1F0] bg-[#F8FBFE] font-bold text-muted">
                <th className="p-2">DATE</th><th className="p-2">IN</th><th className="p-2">OUT</th>
                <th className="p-2">HOURS</th><th className="p-2">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {record.rows.map((row) => {
                const hours = attendanceIntervalHours(row.checkedInAt, row.checkedOutAt);
                return (
                  <tr key={row.id} className="break-inside-avoid border-b border-[#EDF3FB] align-top">
                    <td className="p-2 font-bold">{day(row.date)}</td>
                    <td className="p-2">{time(row.checkedInAt)}</td>
                    <td className="p-2">{time(row.checkedOutAt)}</td>
                    <td className="p-2">{hours === null ? "—" : hours.toFixed(1)}</td>
                    <td className="p-2">
                      {row.checkedInAt ? "Attended" : row.status === "absent" || row.status === "excused"
                        ? `Absent${row.absenceReason ? ` · ${row.absenceReason}` : ""}`
                        : row.status}
                      {row.corrections.length > 0 && (
                        <span className="mt-1 block text-[10px] text-warning-text">
                          Corrected: {row.corrections.map((item) =>
                            `${item.reason}${item.correctedBy ? ` — ${item.correctedBy}` : ""} (${time(item.correctedAt)})`,
                          ).join("; ")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {record.rows.length === 0 && (
            <p className="py-6 text-center text-[12px] text-muted">No recorded attendance this month.</p>
          )}
          <footer className="mt-5 border-t border-[#D6E1F0] pt-3 text-[10px] leading-relaxed text-muted">
            Based on the center’s time-stamped attendance log. Hours use completed check-in/check-out intervals;
            corrections appear with their audit note. Retain this record according to your licensing policy.
          </footer>
        </article>
      ))}
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[#D6E1F0] px-4 py-3">
      <span className="block text-[21px] font-extrabold">{value}</span>
      <span className="block text-[10.5px] text-muted">{label}</span>
    </div>
  );
}
