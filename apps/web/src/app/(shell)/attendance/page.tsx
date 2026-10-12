import {
  listAttendanceCorrections,
  listAttendanceFollowups,
  getAttendanceWeek,
  getClosureForDate,
  getMyDaycare,
  listLatePickupEvents,
  listMissingCheckouts,
  listAttendanceDay,
} from "@dailylog/db/queries";
import Link from "next/link";
import { SectionHeader } from "@/components/shell/header";
import { AttendanceView } from "@/components/attendance/attendance-view";
import { addDateDays, dateInTimeZone, isDate, monthRange } from "@/lib/center-date";
import { getServerSupabase } from "@/lib/supabase/server";

// Attendance 8a — the day view: check-in log, expected-but-not-in, week rail.
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; checkin?: string }>;
}) {
  const params = await searchParams;
  const supabase = await getServerSupabase();
  const daycare = await getMyDaycare(supabase);
  const timeZone = daycare?.timezone ?? "America/Toronto";
  const today = dateInTimeZone(new Date(), timeZone);
  const date = isDate(params.date) ? params.date : today;

  const rows = await listAttendanceDay(supabase, date);
  const attendanceIds = rows.flatMap((row) => row.attendance.map((record) => record.id));
  const month = monthRange(date);
  const [week, closure, corrections, followups, latePickups, missingCheckouts] = await Promise.all([
    getAttendanceWeek(supabase),
    getClosureForDate(supabase, date),
    listAttendanceCorrections(supabase, attendanceIds),
    listAttendanceFollowups(supabase, date),
    listLatePickupEvents(supabase, month.from, addDateDays(month.to, 1)),
    listMissingCheckouts(supabase, date, addDateDays(date, -14)),
  ]);

  const withRecord = rows.map((row) => ({ row, att: row.attendance[0] ?? null }));
  const checkedIn = withRecord.filter((r) => r.att?.checked_in_at).length;
  const checkedOut = withRecord.filter((r) => r.att?.checked_out_at).length;
  const notIn = closure ? 0 : withRecord.filter((r) => !r.att?.checked_in_at).length;

  const label = new Date(`${date}T12:00`).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <SectionHeader
        title="Attendance"
        subtitle={closure
          ? `${label} · center closed · ${closure.reason}`
          : `${label} · ${checkedIn} checked in · ${notIn} expected · ${checkedOut} checked out`}
        showUtilities={false}
        actions={
          <>
            <a
              href={`/attendance-sheet?date=${date}`}
              target="_blank"
              className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-[18px] py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
            >
              Export day
            </a>
            {date === today && !closure && (
              <Link
                href={`/attendance?date=${date}&checkin=1`}
                className="rounded-full bg-primary px-[20px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
              >
                Check in a child
              </Link>
            )}
          </>
        }
      />
      <AttendanceView
        key={`${date}-${params.checkin === "1" ? "checkin" : "overview"}`}
        rows={rows}
        week={week}
        date={date}
        isToday={date === today}
        openCheckIn={params.checkin === "1"}
        timeZone={timeZone}
        closure={closure}
        corrections={corrections}
        followups={followups}
        latePickups={latePickups}
        missingCheckouts={missingCheckouts}
      />
    </>
  );
}
