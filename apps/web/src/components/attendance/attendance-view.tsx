"use client";

import type { AttendanceDayRow, Closure } from "@dailylog/db/queries";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { ArrivalStatusModal } from "./arrival-status-modal";
import { CheckInModal } from "./check-in-modal";
import { FixTimesModal } from "./fix-times-modal";

const card = "rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card";
const cardTitle = "text-[14px] font-extrabold text-ink";
const logColumns = "grid-cols-[1.45fr_.85fr_.55fr_1.15fr_1.25fr]";

interface WeekDay {
  day: string;
  present_count: number;
  absent_count: number;
}

export function AttendanceView({
  rows,
  week,
  date,
  isToday,
  openCheckIn = false,
  timeZone,
  closure,
}: {
  rows: AttendanceDayRow[];
  week: WeekDay[];
  date: string;
  isToday: boolean;
  openCheckIn?: boolean;
  timeZone: string;
  closure: Closure | null;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<
    | "none"
    | "checkin"
    | { kind: "fix"; child: AttendanceDayRow }
    | { kind: "status"; child: AttendanceDayRow }
  >(openCheckIn && isToday && !closure ? "checkin" : "none");
  const [showAllMissing, setShowAllMissing] = useState(false);

  const closeModal = () => {
    setModal("none");
    if (openCheckIn) router.replace(`/attendance?date=${date}`, { scroll: false });
  };

  const missing = rows
    .filter((row) => !row.attendance[0]?.checked_in_at)
    .sort((a, b) => missingPriority(a) - missingPriority(b));
  const visibleMissing = showAllMissing ? missing : missing.slice(0, 3);
  const log = rows
    .filter((row) => row.attendance[0]?.checked_in_at)
    .sort((a, b) =>
      (a.attendance[0].checked_in_at ?? "").localeCompare(
        b.attendance[0].checked_in_at ?? "",
      ),
    );
  const visibleLog = log.slice(0, 5);

  const weekdayBars = week
    .filter((item) => {
      const weekday = new Date(`${item.day}T12:00:00Z`).getUTCDay();
      return weekday >= 1 && weekday <= 5;
    })
    .slice(-5);
  const maxWeek = Math.max(1, ...weekdayBars.map((item) => Number(item.present_count)));
  const currentBar = weekdayBars.find((item) => item.day === date);
  const firstBar = weekdayBars[0];
  const month = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", {
    month: "long",
    timeZone: "UTC",
  });

  return (
    <div className="flex flex-1 flex-col px-7 pb-7 pt-[22px]">
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_298px]">
        <div className="flex min-w-0 flex-col gap-[18px]">
          {closure ? (
            <section
              className={`${card} border-[#D6E1F0] bg-[#F5F8FC] px-[18px] py-[17px]`}
              aria-labelledby="closed-h"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[16px]" aria-hidden>
                  ◷
                </span>
                <span className="min-w-0">
                  <h2 id="closed-h" className={cardTitle}>Center closed — {closure.reason}</h2>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    Attendance is not expected and check-in is disabled for this day.
                    {closure.family_message ? ` ${closure.family_message}` : " Families can see this closure in their app."}
                  </p>
                </span>
              </div>
            </section>
          ) : (
          <section
            className={`${card} border-[#EED39F] px-[18px] py-[17px]`}
            aria-labelledby="expected-h"
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 id="expected-h" className={cardTitle}>
                Expected but not in
              </h2>
              <span className="grid size-5 place-items-center rounded-full bg-warning-bg text-[11px] font-bold text-warning-text">
                {missing.length}
              </span>
              <span className="ml-auto text-[11.5px] text-faint">
                reported absences and arrivals to follow up
              </span>
            </div>

            {visibleMissing.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {visibleMissing.map((row) => {
                  const attendance = row.attendance[0];
                  const badge = missingBadge(row);

                  return (
                    <div key={row.id} className="flex min-h-9 items-center gap-2.5">
                      <Avatar name={`${row.first_name} ${row.last_name}`} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-ink">
                          {row.first_name} {row.last_name} · {row.classroom?.name ?? "No room"}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted">
                          {missingDetail(row, timeZone)}
                        </span>
                      </span>
                      {badge ? (
                        <button
                          type="button"
                          onClick={() => setModal({ kind: "status", child: row })}
                          title="Change family response"
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            badge.tone === "blue"
                              ? "bg-[#E7F0FB] text-primary"
                              : "bg-warning-bg text-warning-text"
                          }`}
                        >
                          {badge.label}
                        </button>
                      ) : (
                        isToday && (
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setModal({ kind: "status", child: row })}
                              className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-3 py-[6.5px] text-[11.5px] font-bold text-primary hover:bg-canvas"
                            >
                              Record reply
                            </button>
                            <Link
                              href={`/messages?child=${row.id}`}
                              className="rounded-full bg-primary px-3.5 py-2 text-[11.5px] font-bold text-white hover:bg-primary-hover"
                            >
                              Message parent
                            </Link>
                          </span>
                        )
                      )}
                      {!isToday && !attendance && (
                        <span className="text-[11.5px] text-faint">No record</span>
                      )}
                    </div>
                  );
                })}
                {missing.length > visibleMissing.length && (
                  <button
                    type="button"
                    onClick={() => setShowAllMissing(true)}
                    className="flex w-fit items-center gap-1 text-[11.5px] font-bold text-primary hover:text-primary-hover"
                    aria-expanded={showAllMissing}
                  >
                    View {missing.length - visibleMissing.length} more not in this day
                    <ChevronDown size={13} aria-hidden />
                  </button>
                )}
                {showAllMissing && missing.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllMissing(false)}
                    className="flex w-fit items-center gap-1 text-[11.5px] font-bold text-primary hover:text-primary-hover"
                    aria-expanded={showAllMissing}
                  >
                    Show fewer
                    <ChevronUp size={13} aria-hidden />
                  </button>
                )}
              </div>
            ) : (
              <p className="text-[12.5px] text-success">
                Everyone expected has arrived.
              </p>
            )}
          </section>
          )}

          <section className={`${card} overflow-hidden`} aria-labelledby="log-h">
            <div className="flex items-center gap-2 px-[18px] py-[15px]">
              <h2 id="log-h" className={cardTitle}>
                Check-in log
              </h2>
              <span className="ml-auto text-[11.5px] text-faint">
                every entry is time-stamped and signed
              </span>
            </div>
            <div
              className={`grid ${logColumns} gap-3 border-y border-[#E3EBF6] bg-[#F8FAFD] px-[18px] py-2.5 font-mono text-[10.5px] font-bold tracking-[.07em] text-faint`}
            >
              <span>CHILD</span>
              <span>ROOM</span>
              <span>IN</span>
              <span>DROPPED OFF BY</span>
              <span>NOTES</span>
            </div>
            {visibleLog.map((row) => {
              const attendance = row.attendance[0];
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setModal({ kind: "fix", child: row })}
                  className={`grid w-full ${logColumns} items-center gap-3 border-b border-[#E3EBF6] px-[18px] py-3 text-left last:border-b-0 hover:bg-[#FAFCFF]`}
                  title={`Correct ${row.first_name}'s attendance times`}
                >
                  <span className="truncate text-[12.5px] font-bold text-ink">
                    {row.first_name} {row.last_name}
                  </span>
                  <span className="truncate text-[12px] text-muted">
                    {row.classroom?.name ?? "—"}
                  </span>
                  <span className="text-[12.5px] font-bold text-ink">
                    {timeOf(attendance.checked_in_at, timeZone)}
                  </span>
                  <span className="truncate text-[12px] text-muted">
                    {attendance.dropped_off_by ?? "—"}
                    {attendance.method === "kiosk" && (
                      <span className="ml-1 text-[10.5px] font-bold text-primary">
                        · verified PIN
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[11.5px] text-faint">
                    {attendance.notes ?? "—"}
                  </span>
                </button>
              );
            })}
            {log.length > visibleLog.length && (
              <div className="px-[18px] py-2.5 text-[11.5px] text-faint">
                + {log.length - visibleLog.length} more today
              </div>
            )}
            {log.length === 0 && (
              <p className="px-[18px] py-5 text-[12.5px] text-faint">
                No check-ins on this day.
              </p>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-[18px]">
          <section className={`${card} px-[18px] py-[17px]`} aria-labelledby="week-h">
            <h2 id="week-h" className={`${cardTitle} mb-4`}>
              This week
            </h2>
            <div className="flex h-[91px] items-end gap-2">
              {weekdayBars.map((item) => {
                const current = item.day === date;
                const count = Number(item.present_count);
                return (
                  <div key={item.day} className="flex h-full flex-1 flex-col justify-end gap-1.5">
                    <div
                      className={`w-full rounded-t-md ${current && closure ? "border border-dashed border-[#AAB8CA] bg-[#E9EFF7]" : current ? "bg-primary" : "bg-[#78A8DF]"}`}
                      style={{ height: `${Math.max(4, (count / maxWeek) * 64)}px` }}
                      title={`${count} checked in`}
                    />
                    <span
                      className={`text-center text-[10px] font-semibold ${current ? "text-ink" : "text-faint"}`}
                    >
                      {weekdayLabel(item.day)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11.5px] leading-normal text-muted">
              {firstBar ? `${weekdayLabel(firstBar.day)} ${firstBar.present_count}` : "No week data"}
              {currentBar ? ` · today ${currentBar.present_count} so far` : ""}
              {" · daily child check-ins"}
            </p>
          </section>

          <section className={`${card} px-[18px] py-[17px]`}>
            <h2 className={`${cardTitle} mb-2.5`}>Late pickups — {month}</h2>
            <p className="text-[12px] leading-relaxed text-muted">
              No billed late pickups are available yet. Late-pickup policy fees
              will appear here when attendance fee automation is enabled.
            </p>
            <Link
              href="/billing?new=1"
              className="mt-2.5 inline-block text-[11.5px] font-bold text-primary hover:text-primary-hover"
            >
              Add a fee to an invoice →
            </Link>
          </section>
        </aside>
      </div>

      {modal === "checkin" && (
        <CheckInModal
          expected={missing
            .filter(
              (row) =>
                !row.attendance[0] ||
                row.attendance[0].status === "late" ||
                row.attendance[0].status === "present",
            )
            .map((row) => ({
              id: row.id,
              name: `${row.first_name} ${row.last_name}`,
              room: row.classroom?.name ?? null,
            }))}
          date={date}
          onClose={closeModal}
        />
      )}
      {typeof modal === "object" && modal.kind === "fix" && (
        <FixTimesModal
          childName={`${modal.child.first_name} ${modal.child.last_name}`}
          record={modal.child.attendance[0]}
          date={date}
          onClose={closeModal}
        />
      )}
      {typeof modal === "object" && modal.kind === "status" && (
        <ArrivalStatusModal child={modal.child} date={date} onClose={closeModal} />
      )}
    </div>
  );
}

function missingPriority(row: AttendanceDayRow): number {
  const attendance = row.attendance[0];
  if (!attendance) return 0;
  if (attendance.status === "late") return 1;
  if (attendance.status === "excused") return 2;
  return 3;
}

function missingBadge(
  row: AttendanceDayRow,
): { label: string; tone: "blue" | "warning" } | null {
  const attendance = row.attendance[0];
  if (!attendance) return null;
  if (attendance.status === "late") return { label: "Coming", tone: "blue" };
  if (attendance.status === "excused") return { label: "Excused", tone: "warning" };
  if (attendance.status === "absent") {
    const reason = attendance.absence_reason?.toLowerCase() ?? "";
    return {
      label: reason.includes("sick") ? "Sick" : "Absent",
      tone: "warning",
    };
  }
  return null;
}

function missingDetail(row: AttendanceDayRow, timeZone: string): string {
  const attendance = row.attendance[0];
  if (!attendance) return "No response yet";
  if (attendance.status === "late") {
    return attendance.notes || "Family reported they are running late";
  }
  if (attendance.status === "absent") {
    const reason = attendance.absence_reason ?? "absent";
    return `Marked ${reason} by ${attendance.method === "parent" ? "parent" : "admin"}${
      attendance.updated_at ? ` at ${timeOf(attendance.updated_at, timeZone)}` : ""
    }`;
  }
  if (attendance.status === "excused") {
    return `${attendance.notes || "Excused absence"}${
      attendance.method === "parent" ? " · reported by family" : " · recorded by admin"
    }`;
  }
  return "No response yet";
}

function weekdayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short",
    timeZone: "UTC",
  });
}

function timeOf(timestamp: string | null, timeZone: string): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}
