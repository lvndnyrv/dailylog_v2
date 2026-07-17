"use client";

import type { AttendanceDayRow } from "@dailylog/db/queries";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { checkOutAction, markAbsentAction } from "@/lib/attendance/actions";
import { CheckInModal } from "./check-in-modal";
import { FixTimesModal } from "./fix-times-modal";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";
const th = "font-bold text-[10.5px] tracking-[.07em] text-faint";

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
}: {
  rows: AttendanceDayRow[];
  week: WeekDay[];
  date: string;
  isToday: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<
    "none" | "checkin" | { fix: AttendanceDayRow }
  >("none");

  const expected = rows.filter((row) => {
    const att = row.attendance[0];
    return !att?.checked_in_at && att?.status !== "absent" && att?.status !== "excused";
  });
  const absent = rows.filter((row) => {
    const att = row.attendance[0];
    return att?.status === "absent" || att?.status === "excused";
  });
  const log = rows
    .filter((row) => row.attendance[0]?.checked_in_at)
    .sort((a, b) =>
      (a.attendance[0].checked_in_at ?? "").localeCompare(b.attendance[0].checked_in_at ?? ""),
    );

  const maxWeek = Math.max(1, ...week.map((d) => Number(d.present_count)));

  return (
    <div className="flex flex-1 flex-col gap-4 p-7">
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => router.push(`/attendance?date=${e.target.value}`)}
          className="rounded-[11px] border-[1.5px] border-[#D6E1F0] bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-primary"
          aria-label="Attendance date"
        />
        <span className="flex-1" />
        <a
          href={`/attendance-sheet?date=${date}`}
          target="_blank"
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Export day
        </a>
        {isToday && (
          <button
            type="button"
            onClick={() => setModal("checkin")}
            className="rounded-btn bg-primary px-[18px] py-2 text-[13px] font-bold text-white hover:bg-primary-hover"
          >
            Check in a child
          </button>
        )}
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Expected but not in */}
          {(expected.length > 0 || absent.length > 0) && (
            <section className={card} aria-labelledby="expected-h">
              <div className="mb-3 flex items-center gap-2">
                <h2 id="expected-h" className={cardTitle}>
                  Expected but not in
                </h2>
                <span className="grid size-5 place-items-center rounded-full bg-warning-bg text-[11px] font-bold text-warning-text">
                  {expected.length}
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                {expected.map((row) => (
                  <div key={row.id} className="flex items-center gap-2.5">
                    <Avatar name={`${row.first_name} ${row.last_name}`} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink">
                        {row.first_name} {row.last_name}
                        <span className="font-semibold text-faint">
                          {" "}
                          · {row.classroom?.name ?? "no room"}
                        </span>
                      </span>
                    </span>
                    {isToday && (
                      <form action={markAbsentAction}>
                        <input type="hidden" name="child_id" value={row.id} />
                        <input type="hidden" name="date" value={date} />
                        <input type="hidden" name="reason" value="marked by admin" />
                        <button
                          type="submit"
                          className="rounded-btn border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-xs font-bold text-warning-text hover:bg-warning-bg"
                        >
                          Mark absent
                        </button>
                      </form>
                    )}
                  </div>
                ))}
                {absent.map((row) => (
                  <div key={row.id} className="flex items-center gap-2.5 opacity-80">
                    <Avatar name={`${row.first_name} ${row.last_name}`} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink">
                        {row.first_name} {row.last_name}
                      </span>
                      <span className="block text-[11.5px] text-muted">
                        {row.attendance[0]?.absence_reason ?? "absent"}
                      </span>
                    </span>
                    <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">
                      {row.attendance[0]?.status === "excused" ? "Excused" : "Absent"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Check-in log */}
          <section className={card} aria-labelledby="log-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="log-h" className={cardTitle}>
                Check-in log
              </h2>
              <span className="text-[11.5px] text-faint">
                every entry is time-stamped and signed
              </span>
            </div>
            <div className={`grid grid-cols-[1.5fr_.9fr_.6fr_.6fr_1.1fr_90px] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
              <span>CHILD</span>
              <span>ROOM</span>
              <span>IN</span>
              <span>OUT</span>
              <span>DROPPED OFF BY</span>
              <span />
            </div>
            {log.map((row) => {
              const att = row.attendance[0];
              return (
                <div
                  key={row.id}
                  className="grid grid-cols-[1.5fr_.9fr_.6fr_.6fr_1.1fr_90px] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
                >
                  <span className="flex items-center gap-2.5">
                    <Avatar name={`${row.first_name} ${row.last_name}`} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-ink">
                        {row.first_name} {row.last_name}
                      </span>
                      {att.notes && (
                        <span className="block truncate text-[11px] text-faint">{att.notes}</span>
                      )}
                    </span>
                  </span>
                  <span className="text-[12.5px] text-muted">{row.classroom?.name ?? "—"}</span>
                  <span className="text-[12.5px] font-semibold text-success">
                    {timeOf(att.checked_in_at)}
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {att.checked_out_at ? timeOf(att.checked_out_at) : "—"}
                  </span>
                  <span className="truncate text-[12.5px] text-muted">
                    {att.dropped_off_by ?? "—"}
                    {att.method === "kiosk" && (
                      <span className="ml-1 rounded-full bg-[#E7F0FB] px-1.5 py-px text-[10px] font-bold text-primary">
                        kiosk
                      </span>
                    )}
                  </span>
                  <span className="flex justify-end gap-1.5">
                    {isToday && !att.checked_out_at && (
                      <form action={checkOutAction}>
                        <input type="hidden" name="record_id" value={att.id} />
                        <button
                          type="submit"
                          className="rounded-btn border-[1.5px] border-[#D6E1F0] px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-canvas"
                        >
                          Check out
                        </button>
                      </form>
                    )}
                    <button
                      type="button"
                      onClick={() => setModal({ fix: row })}
                      title="Fix times"
                      className="rounded-btn border-[1.5px] border-[#D6E1F0] px-2 py-1 text-[11px] font-bold text-muted hover:bg-canvas"
                    >
                      ✎
                    </button>
                  </span>
                </div>
              );
            })}
            {log.length === 0 && (
              <p className="pt-3 text-[12.5px] text-faint">No check-ins on this day.</p>
            )}
          </section>
        </div>

        {/* Right rail */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-labelledby="week-h">
            <h2 id="week-h" className={`${cardTitle} mb-3`}>
              This week
            </h2>
            <div className="flex items-end gap-2" style={{ height: 90 }}>
              {week.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10.5px] font-bold text-ink">
                    {d.present_count}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-primary/80"
                    style={{
                      height: `${(Number(d.present_count) / maxWeek) * 60 + 2}px`,
                    }}
                  />
                  <span className="text-[10px] font-semibold text-faint">
                    {new Date(`${d.day}T12:00`).toLocaleDateString("en-CA", {
                      weekday: "short",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className={card}>
            <h2 className={`${cardTitle} mb-2`}>Late pickups</h2>
            <p className="text-[12.5px] text-faint">
              Fee automation isn&apos;t built yet — for now, add a late-pickup line
              to the family&apos;s next{" "}
              <a href="/billing?new=1" className="font-bold text-primary hover:text-primary-hover">
                invoice
              </a>
              .
            </p>
          </section>

          <section className={card}>
            <h2 className={`${cardTitle} mb-2`}>Door kiosk</h2>
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              Families check in and out on the door tablet with their 4-digit
              pickup PIN. Open it on this device to try it.
            </p>
            <a
              href="/kiosk"
              target="_blank"
              className="inline-block rounded-btn border-[1.5px] border-[#D6E1F0] px-4 py-2 text-[13px] font-bold text-primary hover:bg-canvas"
            >
              Open kiosk →
            </a>
          </section>
        </div>
      </div>

      {modal === "checkin" && (
        <CheckInModal
          expected={expected.map((row) => ({
            id: row.id,
            name: `${row.first_name} ${row.last_name}`,
            room: row.classroom?.name ?? null,
          }))}
          date={date}
          onClose={() => setModal("none")}
        />
      )}
      {typeof modal === "object" && (
        <FixTimesModal
          childName={`${modal.fix.first_name} ${modal.fix.last_name}`}
          record={modal.fix.attendance[0]}
          date={date}
          onClose={() => setModal("none")}
        />
      )}
    </div>
  );
}

function timeOf(timestamp: string | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  });
}
