import { getAttendanceWeek, listAttendanceDay } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { AttendanceView } from "@/components/attendance/attendance-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Attendance 8a — the day view: check-in log, expected-but-not-in, week rail.
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : today;

  const supabase = await getServerSupabase();
  const [rows, week] = await Promise.all([
    listAttendanceDay(supabase, date),
    getAttendanceWeek(supabase),
  ]);

  const withRecord = rows.map((row) => ({ row, att: row.attendance[0] ?? null }));
  const checkedIn = withRecord.filter((r) => r.att?.checked_in_at).length;
  const checkedOut = withRecord.filter((r) => r.att?.checked_out_at).length;
  const expected = withRecord.filter(
    (r) => !r.att?.checked_in_at && r.att?.status !== "absent" && r.att?.status !== "excused",
  ).length;

  const label = new Date(`${date}T12:00`).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <SectionHeader
        title="Attendance"
        subtitle={`${label} · ${checkedIn} checked in · ${expected} expected · ${checkedOut} checked out`}
      />
      <AttendanceView rows={rows} week={week} date={date} isToday={date === today} />
    </>
  );
}
