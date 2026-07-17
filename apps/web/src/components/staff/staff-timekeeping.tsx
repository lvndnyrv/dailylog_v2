"use client";

import type {
  StaffRow,
  StaffShiftRow,
  StaffTimeEntryRow,
  StaffTimeOffRequestRow,
} from "@dailylog/db/queries";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { addDateDays, dateInTimeZone, monthRange } from "@/lib/center-date";
import {
  approveTimeEntriesAction,
  fixTimeEntryAction,
  reviewTimeOffAction,
} from "@/lib/staff/actions";

type Sheet = {
  staffId: string;
  name: string;
  room: string | null;
  shifts: StaffShiftRow[];
  entries: StaffTimeEntryRow[];
  scheduledMinutes: number;
  clockedMinutes: number;
  breakMinutes: number;
  reviewableIds: string[];
  hasOpenEntry: boolean;
  allApproved: boolean;
};

const HEAD = "font-bold text-[10.5px] tracking-[.07em] text-faint";
const card = "overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card";

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}

function minutesBetween(start: string, end: string, breakMinutes = 0): number {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000) - breakMinutes,
  );
}

function dateLabel(value: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function timeLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function toLocalInput(value: Date): string {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function requestDays(request: StaffTimeOffRequestRow): number {
  return Math.round(
    (new Date(`${request.ends_on}T12:00:00Z`).getTime() -
      new Date(`${request.starts_on}T12:00:00Z`).getTime()) /
      86400000,
  ) + 1;
}

function requestRange(request: StaffTimeOffRequestRow): string {
  return request.starts_on === request.ends_on
    ? dateLabel(request.starts_on)
    : `${dateLabel(request.starts_on)}–${dateLabel(request.ends_on)}`;
}

export function StaffTimekeeping({
  mode,
  staff,
  shifts,
  entries,
  requests,
  timeZone,
  weekStart,
  month,
  error,
}: {
  mode: "timesheets" | "time-off";
  staff: StaffRow[];
  shifts: StaffShiftRow[];
  entries: StaffTimeEntryRow[];
  requests: StaffTimeOffRequestRow[];
  timeZone: string;
  weekStart: string;
  month: string;
  error: string | null;
}) {
  const router = useRouter();
  const [selectedSheet, setSelectedSheet] = useState<Sheet | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<StaffTimeOffRequestRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const weekEnd = addDateDays(weekStart, 6);

  const weekShifts = useMemo(
    () =>
      shifts.filter((shift) => {
        const date = dateInTimeZone(shift.starts_at, timeZone);
        return date >= weekStart && date <= weekEnd && shift.status !== "cancelled";
      }),
    [shifts, timeZone, weekEnd, weekStart],
  );
  const weekEntries = useMemo(
    () =>
      entries.filter((entry) => {
        const date = dateInTimeZone(entry.clocked_in_at, timeZone);
        return date >= weekStart && date <= weekEnd;
      }),
    [entries, timeZone, weekEnd, weekStart],
  );

  const sheets = useMemo<Sheet[]>(() => {
    const staffById = new Map(staff.map((member) => [member.id, member]));
    const ids = new Set([
      ...weekShifts.map((shift) => shift.staff?.id).filter((id): id is string => Boolean(id)),
      ...weekEntries.map((entry) => entry.staff?.id).filter((id): id is string => Boolean(id)),
    ]);
    return [...ids]
      .map((staffId) => {
        const member = staffById.get(staffId);
        const memberShifts = weekShifts.filter((shift) => shift.staff?.id === staffId);
        const memberEntries = weekEntries.filter((entry) => entry.staff?.id === staffId);
        const profile =
          member?.profile ?? memberEntries[0]?.staff?.profile ?? memberShifts[0]?.staff?.profile;
        const scheduledMinutes = memberShifts.reduce(
          (total, shift) =>
            total + minutesBetween(shift.starts_at, shift.ends_at, shift.unpaid_break_minutes),
          0,
        );
        const closed = memberEntries.filter((entry) => entry.clocked_out_at);
        const clockedMinutes = closed.reduce(
          (total, entry) =>
            total + minutesBetween(entry.clocked_in_at, entry.clocked_out_at!, entry.break_minutes),
          0,
        );
        return {
          staffId,
          name: profile?.full_name ?? "Unknown staff member",
          room: profile?.classroom?.name ?? memberEntries[0]?.classroom?.name ?? null,
          shifts: memberShifts,
          entries: memberEntries,
          scheduledMinutes,
          clockedMinutes,
          breakMinutes: closed.reduce((total, entry) => total + entry.break_minutes, 0),
          reviewableIds: memberEntries
            .filter((entry) => ["submitted", "rejected"].includes(entry.status))
            .map((entry) => entry.id),
          hasOpenEntry: memberEntries.some((entry) => entry.status === "open"),
          allApproved:
            memberEntries.length > 0 && memberEntries.every((entry) => entry.status === "approved"),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, weekEntries, weekShifts]);

  const reviewableIds = sheets.flatMap((sheet) => sheet.reviewableIds);
  const closedEntries = weekEntries.filter((entry) => entry.clocked_out_at);
  const exportReady =
    closedEntries.length > 0 &&
    !weekEntries.some((entry) => entry.status === "open") &&
    closedEntries.every((entry) => entry.status === "approved");
  const regularMinutes = sheets.reduce(
    (total, sheet) => total + Math.min(sheet.clockedMinutes, 40 * 60),
    0,
  );
  const overtimeMinutes = sheets.reduce(
    (total, sheet) => total + Math.max(0, sheet.clockedMinutes - 40 * 60),
    0,
  );

  const approve = (ids: string[], closeDetail = false) => {
    setActionError(null);
    startTransition(async () => {
      const result = await approveTimeEntriesAction(ids);
      if (result.error) {
        setActionError(result.error);
        return;
      }
      if (closeDetail) setSelectedSheet(null);
      router.refresh();
    });
  };

  if (error) {
    return (
      <div className="rounded-2xl border-[1.5px] border-[#EFD9B5] bg-warning-bg px-5 py-4">
        <p className="text-[13px] font-bold text-ink">Timekeeping setup is not available yet</p>
        <p className="mt-1 text-[12px] leading-relaxed text-warning-text">
          Apply the P0 scheduling migration to the connected Supabase project, then reload this tab.
          The Staff roster remains available in the meantime.
        </p>
      </div>
    );
  }

  return (
    <>
      {mode === "timesheets" ? (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => router.push(`/staff?tab=timesheets&week=${addDateDays(weekStart, -7)}`)}
              className="grid size-9 place-items-center rounded-btn border-[1.5px] border-[#D6E1F0] bg-card font-bold text-muted hover:bg-canvas"
            >
              ‹
            </button>
            <span className="min-w-[190px] text-center text-[13px] font-bold text-ink">
              {dateLabel(weekStart)} – {dateLabel(weekEnd)}
            </span>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => router.push(`/staff?tab=timesheets&week=${addDateDays(weekStart, 7)}`)}
              className="grid size-9 place-items-center rounded-btn border-[1.5px] border-[#D6E1F0] bg-card font-bold text-muted hover:bg-canvas"
            >
              ›
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setExporting(true)}
              className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2 text-[12.5px] font-bold text-ink hover:bg-canvas"
            >
              Export to payroll
            </button>
            {reviewableIds.length > 0 && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => approve(reviewableIds)}
                className="rounded-btn bg-primary px-4 py-[9px] text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                Approve all {new Set(sheets.filter((sheet) => sheet.reviewableIds.length).map((sheet) => sheet.staffId)).size}
              </button>
            )}
          </div>

          {actionError && (
            <p role="alert" className="rounded-xl bg-danger-bg px-4 py-2.5 text-[12px] font-semibold text-danger">
              {actionError}
            </p>
          )}

          <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_280px]">
            <section className={card} aria-labelledby="pending-timesheets">
              <div className="flex items-center gap-2 border-b-[1.5px] border-[#EDF3FB] px-[18px] py-[13px]">
                <h2 id="pending-timesheets" className="text-[15px] font-extrabold text-ink">
                  Weekly timesheets
                </h2>
                {reviewableIds.length > 0 && (
                  <span className="rounded-full bg-danger-bg px-2.5 py-[3px] text-[11px] font-bold text-danger">
                    {new Set(sheets.filter((sheet) => sheet.reviewableIds.length).map((sheet) => sheet.staffId)).size} pending
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className={`grid grid-cols-[1.35fr_.7fr_.7fr_.65fr_1fr_142px] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${HEAD}`}>
                    <span>PERSON</span>
                    <span>SCHEDULED</span>
                    <span>CLOCKED</span>
                    <span>BREAKS</span>
                    <span>FLAGS</span>
                    <span />
                  </div>
                  {sheets.map((sheet) => {
                    const overtime = Math.max(0, sheet.clockedMinutes - 40 * 60);
                    const noEntries = sheet.entries.length === 0 && sheet.scheduledMinutes > 0;
                    const flagged = sheet.hasOpenEntry || overtime > 0 || noEntries;
                    return (
                      <div
                        key={sheet.staffId}
                        className={`grid grid-cols-[1.35fr_.7fr_.7fr_.65fr_1fr_142px] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0 ${flagged ? "bg-[#FFFDF8]" : ""}`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={sheet.name} size={30} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-ink">{sheet.name}</span>
                            <span className="block truncate text-[10.5px] text-faint">{sheet.room ?? "Unassigned"}</span>
                          </span>
                        </span>
                        <span className="text-[12.5px] text-muted">{hours(sheet.scheduledMinutes)}</span>
                        <span className={`text-[13px] font-bold ${overtime ? "text-warning-text" : "text-ink"}`}>
                          {hours(sheet.clockedMinutes)}
                        </span>
                        <span className="text-[12.5px] text-muted">{hours(sheet.breakMinutes)}</span>
                        <span className="text-[11px] font-bold">
                          {sheet.hasOpenEntry ? (
                            <span className="rounded-full bg-warning-bg px-2 py-1 text-warning-text">Open clock-in</span>
                          ) : overtime ? (
                            <span className="rounded-full bg-warning-bg px-2 py-1 text-warning-text">{hours(overtime)} overtime</span>
                          ) : noEntries ? (
                            <span className="rounded-full bg-danger-bg px-2 py-1 text-danger">No punches</span>
                          ) : sheet.allApproved ? (
                            <span className="text-success">Approved ✓</span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </span>
                        <span className="flex items-center justify-end gap-2">
                          {sheet.reviewableIds.length > 0 && !sheet.hasOpenEntry && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => approve(sheet.reviewableIds)}
                              className="rounded-btn bg-primary px-3 py-1.5 text-[11.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-60"
                            >
                              Approve
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedSheet(sheet)}
                            className="text-[11.5px] font-bold text-primary hover:text-primary-hover"
                          >
                            Detail
                          </button>
                        </span>
                      </div>
                    );
                  })}
                  {sheets.length === 0 && (
                    <div className="px-6 py-12 text-center">
                      <p className="text-[13px] font-bold text-ink">No time activity this week</p>
                      <p className="mt-1 text-[12px] text-muted">
                        Published shifts and staff clock-ins will appear here automatically.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="flex flex-col gap-[18px]">
              <section className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card p-4">
                <h2 className="mb-3 text-[14px] font-extrabold text-ink">Week totals</h2>
                <Total label="Regular hours" value={hours(regularMinutes)} />
                <Total label="Overtime" value={hours(overtimeMinutes)} warn={overtimeMinutes > 0} />
                <Total label="Breaks" value={hours(sheets.reduce((sum, sheet) => sum + sheet.breakMinutes, 0))} />
                <Total label="Approved" value={`${closedEntries.filter((entry) => entry.status === "approved").length}/${closedEntries.length}`} />
                <p className="mt-3 text-[11px] leading-normal text-faint">
                  Payroll export unlocks when every closed entry is approved and no clock-in is open.
                </p>
              </section>
              <UpcomingTimeOff requests={requests} onSelect={setSelectedRequest} />
            </aside>
          </div>
        </div>
      ) : (
        <TimeOffCalendar
          month={month}
          requests={requests}
          shifts={shifts}
          timeZone={timeZone}
          onSelect={setSelectedRequest}
        />
      )}

      {selectedSheet && (
        <TimesheetDetailModal
          sheet={selectedSheet}
          timeZone={timeZone}
          busy={isPending}
          error={actionError}
          onClose={() => {
            setSelectedSheet(null);
            setActionError(null);
          }}
          onApprove={() => approve(selectedSheet.reviewableIds, true)}
          onFixed={() => {
            setSelectedSheet(null);
            router.refresh();
          }}
        />
      )}
      {selectedRequest && (
        <TimeOffDecisionModal
          request={selectedRequest}
          busy={isPending}
          onClose={() => setSelectedRequest(null)}
          onDecision={(decision, notes) => {
            setActionError(null);
            startTransition(async () => {
              const result = await reviewTimeOffAction({
                requestId: selectedRequest.id,
                decision,
                notes,
              });
              if (result.error) {
                setActionError(result.error);
                return;
              }
              setSelectedRequest(null);
              router.refresh();
            });
          }}
          error={actionError}
        />
      )}
      {exporting && (
        <PayrollExportModal
          weekStart={weekStart}
          weekEnd={weekEnd}
          regularMinutes={regularMinutes}
          overtimeMinutes={overtimeMinutes}
          approved={closedEntries.filter((entry) => entry.status === "approved").length}
          total={closedEntries.length}
          ready={exportReady}
          onClose={() => setExporting(false)}
        />
      )}
    </>
  );
}

function Total({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between py-1 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <span className={`font-bold ${warn ? "text-warning-text" : "text-ink"}`}>{value}</span>
    </div>
  );
}

function UpcomingTimeOff({
  requests,
  onSelect,
}: {
  requests: StaffTimeOffRequestRow[];
  onSelect: (request: StaffTimeOffRequestRow) => void;
}) {
  const upcoming = requests.filter((request) => request.status !== "declined").slice(0, 4);
  return (
    <section className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card p-4">
      <h2 className="mb-3 text-[14px] font-extrabold text-ink">Out this month</h2>
      {upcoming.map((request) => (
        <button
          key={request.id}
          type="button"
          onClick={() => onSelect(request)}
          className="flex w-full items-center gap-2.5 border-b border-[#EDF3FB] py-2 text-left last:border-0"
        >
          <span className={`rounded-lg px-2 py-1 text-[10.5px] font-bold ${request.status === "approved" ? "bg-[#E4F3EC] text-success" : "bg-warning-bg text-warning-text"}`}>
            {requestRange(request)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">
            {request.staff?.profile?.full_name ?? "Staff member"}
          </span>
        </button>
      ))}
      {upcoming.length === 0 && <p className="text-[11.5px] text-faint">No time off this month.</p>}
    </section>
  );
}

function TimesheetDetailModal({
  sheet,
  timeZone,
  busy,
  error,
  onClose,
  onApprove,
  onFixed,
}: {
  sheet: Sheet;
  timeZone: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApprove: () => void;
  onFixed: () => void;
}) {
  return (
    <Modal onClose={onClose} width={620}>
      <div className="flex items-start gap-3">
        <Avatar name={sheet.name} size={38} />
        <span className="flex-1">
          <span className="block text-[19px] font-extrabold text-ink">{sheet.name}</span>
          <span className="block text-[12px] text-muted">Timesheet detail · {sheet.room ?? "Unassigned"}</span>
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full bg-canvas text-muted">×</button>
      </div>

      <div className="overflow-hidden rounded-[14px] border-[1.5px] border-[#D6E1F0]">
        <div className={`grid grid-cols-[1.1fr_.8fr_.8fr_.65fr_.6fr] gap-2 bg-[#F8FBFE] px-4 py-2.5 ${HEAD}`}>
          <span>DAY</span><span>IN</span><span>OUT</span><span>BREAK</span><span className="text-right">HOURS</span>
        </div>
        {sheet.entries.map((entry) => (
          <div key={entry.id} className="border-t border-[#EDF3FB] px-4 py-2.5">
            <div className="grid grid-cols-[1.1fr_.8fr_.8fr_.65fr_.6fr] items-center gap-2">
              <span className="text-[12.5px] font-bold text-ink">
                {new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone }).format(new Date(entry.clocked_in_at))}
              </span>
              <span className="text-[12.5px] text-muted">{timeLabel(entry.clocked_in_at, timeZone)}</span>
              <span className={`text-[12.5px] ${entry.clocked_out_at ? "text-muted" : "font-bold text-danger"}`}>
                {entry.clocked_out_at ? timeLabel(entry.clocked_out_at, timeZone) : "missing"}
              </span>
              <span className="text-[12.5px] text-muted">{entry.break_minutes}m</span>
              <span className="text-right text-[12.5px] font-bold text-ink">
                {entry.clocked_out_at ? hours(minutesBetween(entry.clocked_in_at, entry.clocked_out_at, entry.break_minutes)) : "—"}
              </span>
            </div>
            {entry.status === "open" && <OpenEntryFix entry={entry} onFixed={onFixed} />}
          </div>
        ))}
        {sheet.entries.length === 0 && (
          <p className="border-t border-[#EDF3FB] px-4 py-8 text-center text-[12px] text-faint">No clock entries for this week.</p>
        )}
      </div>

      {error && <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{error}</p>}
      <div className="flex items-center gap-4 rounded-xl bg-[#F8FBFE] px-4 py-3 text-[12px] text-muted">
        <span>Scheduled <b className="text-ink">{hours(sheet.scheduledMinutes)}</b></span>
        <span>Clocked <b className="text-ink">{hours(sheet.clockedMinutes)}</b></span>
        <span>Breaks <b className="text-ink">{hours(sheet.breakMinutes)}</b></span>
        <span className="flex-1" />
        {sheet.reviewableIds.length > 0 && !sheet.hasOpenEntry && (
          <button type="button" disabled={busy} onClick={onApprove} className="rounded-btn bg-primary px-4 py-2 text-[12px] font-bold text-white hover:bg-primary-hover disabled:opacity-60">
            Approve timesheet
          </button>
        )}
      </div>
    </Modal>
  );
}

function OpenEntryFix({ entry, onFixed }: { entry: StaffTimeEntryRow; onFixed: () => void }) {
  const [clockOut, setClockOut] = useState(toLocalInput(new Date()));
  const [breakMinutes, setBreakMinutes] = useState(entry.break_minutes || 30);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-2.5 grid grid-cols-[1fr_90px_1fr_auto] items-end gap-2 rounded-xl border border-[#EFD9B5] bg-warning-bg p-3">
      <label className="text-[10.5px] font-bold text-ink">
        ADD CLOCK-OUT
        <input type="datetime-local" value={clockOut} onChange={(event) => setClockOut(event.target.value)} className="mt-1 w-full rounded-lg border border-[#D6E1F0] bg-card px-2 py-1.5 text-[12px] font-semibold outline-none" />
      </label>
      <label className="text-[10.5px] font-bold text-ink">
        BREAK
        <input type="number" min={0} max={720} value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-[#D6E1F0] bg-card px-2 py-1.5 text-[12px] outline-none" />
      </label>
      <label className="text-[10.5px] font-bold text-ink">
        NOTE
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Confirmed with staff" className="mt-1 w-full rounded-lg border border-[#D6E1F0] bg-card px-2 py-1.5 text-[12px] outline-none" />
      </label>
      <button
        type="button"
        disabled={pending || !clockOut}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await fixTimeEntryAction({
              entryId: entry.id,
              clockedOutAt: new Date(clockOut).toISOString(),
              breakMinutes,
              notes,
            });
            if (result.error) setError(result.error);
            else onFixed();
          });
        }}
        className="rounded-btn bg-primary px-3 py-2 text-[11.5px] font-bold text-white disabled:opacity-60"
      >
        Save fix
      </button>
      {error && <p role="alert" className="col-span-full text-[11px] font-semibold text-danger">{error}</p>}
    </div>
  );
}

function TimeOffCalendar({
  month,
  requests,
  shifts,
  timeZone,
  onSelect,
}: {
  month: string;
  requests: StaffTimeOffRequestRow[];
  shifts: StaffShiftRow[];
  timeZone: string;
  onSelect: (request: StaffTimeOffRequestRow) => void;
}) {
  const router = useRouter();
  const range = monthRange(`${month}-01`);
  const first = new Date(`${range.from}T12:00:00Z`);
  const calendarStart = addDateDays(range.from, -first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, index) => addDateDays(calendarStart, index));
  const pending = requests.filter((request) => request.status === "pending");

  const moveMonth = (amount: number) => {
    const value = new Date(`${month}-01T12:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + amount);
    router.push(`/staff?tab=time-off&month=${value.toISOString().slice(0, 7)}`);
  };

  const needsCoverageReview = (request: StaffTimeOffRequestRow) =>
    shifts.some(
      (shift) =>
        shift.staff?.id === request.staff?.id &&
        dateInTimeZone(shift.starts_at, timeZone) >= request.starts_on &&
        dateInTimeZone(shift.starts_at, timeZone) <= request.ends_on &&
        shift.status !== "cancelled",
    );

  return (
    <div className="flex flex-col gap-[18px]">
      {pending.length > 0 && (
        <section className={card}>
          <div className="flex items-center gap-2 border-b-[1.5px] border-[#EDF3FB] px-[18px] py-[13px]">
            <h2 className="text-[15px] font-extrabold text-ink">Pending requests</h2>
            <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">{pending.length}</span>
          </div>
          {pending.map((request) => (
            <div key={request.id} className="flex flex-wrap items-center gap-3 border-b border-[#EDF3FB] px-[18px] py-3 last:border-0">
              <Avatar name={request.staff?.profile?.full_name ?? "Staff"} size={30} />
              <span className="min-w-[240px] flex-1">
                <span className="block text-[13px] font-bold text-ink">
                  {request.staff?.profile?.full_name ?? "Staff member"} · {requestRange(request)} · {requestDays(request)} {requestDays(request) === 1 ? "day" : "days"}
                </span>
                <span className="block text-[11.5px] text-muted">
                  {request.staff?.profile?.classroom?.name ?? "No room"} · {request.kind}
                  {needsCoverageReview(request) ? " · coverage review needed" : " · no published shift conflict"}
                </span>
              </span>
              <button type="button" onClick={() => onSelect(request)} className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-2 text-[11.5px] font-bold text-ink hover:bg-canvas">
                Review
              </button>
            </div>
          ))}
        </section>
      )}

      <section className={card}>
        <div className="flex flex-wrap items-center gap-3 border-b-[1.5px] border-[#EDF3FB] px-[18px] py-[14px]">
          <span className="flex-1">
            <span className="block text-[17px] font-extrabold text-ink">Time off</span>
            <span className="block text-[11.5px] text-faint">Published-shift conflicts are flagged for coverage review</span>
          </span>
          <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} className="grid size-8 place-items-center rounded-btn border border-[#D6E1F0] bg-card text-muted">‹</button>
          <span className="min-w-28 text-center text-[13px] font-bold text-ink">
            {new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`))}
          </span>
          <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} className="grid size-8 place-items-center rounded-btn border border-[#D6E1F0] bg-card text-muted">›</button>
          <span className="ml-2 flex gap-3 text-[10.5px] text-faint">
            <span><i className="mr-1 inline-block size-2.5 rounded-[3px] bg-success" />Approved</span>
            <span><i className="mr-1 inline-block size-2.5 rounded-[3px] bg-warning" />Pending</span>
          </span>
        </div>
        <div className="p-4">
          <div className={`mb-1 grid grid-cols-7 gap-1.5 text-center ${HEAD}`}>
            {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((day) => {
              const dayRequests = requests.filter((request) => request.status !== "declined" && request.starts_on <= day && request.ends_on >= day);
              const inMonth = day.startsWith(month);
              return (
                <div key={day} className={`min-h-16 rounded-[9px] border p-1.5 ${inMonth ? "border-[#EDF3FB] bg-card" : "border-[#F2F6FB] bg-[#FBFDFF]"}`}>
                  <span className={`text-[10.5px] font-bold ${inMonth ? "text-ink" : "text-[#C4CEDC]"}`}>{Number(day.slice(-2))}</span>
                  {dayRequests.slice(0, 2).map((request) => (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() => onSelect(request)}
                      className={`mt-1 block w-full truncate rounded-[5px] px-1.5 py-0.5 text-left text-[9.5px] font-bold ${request.status === "approved" ? "bg-[#E4F3EC] text-success" : "bg-warning-bg text-warning-text"}`}
                    >
                      {request.staff?.profile?.full_name ?? "Staff"}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function TimeOffDecisionModal({
  request,
  busy,
  error,
  onClose,
  onDecision,
}: {
  request: StaffTimeOffRequestRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onDecision: (decision: "approved" | "declined", notes: string) => void;
}) {
  const [notes, setNotes] = useState(request.decision_notes ?? "");
  const pending = request.status === "pending";
  return (
    <Modal onClose={onClose} width={450}>
      <div className="flex items-start gap-3">
        <span className="flex-1">
          <span className="block text-[19px] font-extrabold text-ink">Time-off decision</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">
            {request.staff?.profile?.full_name ?? "Staff member"} · {requestRange(request)} · {requestDays(request)} {requestDays(request) === 1 ? "day" : "days"}
          </span>
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full bg-canvas text-muted">×</button>
      </div>
      <div className="rounded-[14px] border border-[#EFD9B5] bg-warning-bg px-4 py-3 text-[12px] leading-relaxed text-warning-text">
        Check the room schedule before approving. DailyLog flags published shifts, but forecast ratio coverage requires child schedule data.
      </div>
      <label className="text-[12px] font-bold text-ink">
        Note to staff <span className="font-normal text-faint">(optional)</span>
        <textarea disabled={!pending} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add context or suggest another date…" className="mt-1.5 min-h-20 w-full resize-none rounded-xl border-[1.5px] border-[#D6E1F0] bg-[#F9FBFE] px-3.5 py-2.5 text-[13px] font-normal outline-none focus:border-primary disabled:text-muted" />
      </label>
      {error && <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{error}</p>}
      <div className="flex justify-end gap-2.5">
        {!pending ? (
          <button type="button" onClick={onClose} className="rounded-btn bg-primary px-5 py-2.5 text-[12.5px] font-bold text-white hover:bg-primary-hover">Close</button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => onDecision("declined", notes)} className="rounded-btn border-[1.5px] border-[#E9BFC0] bg-card px-4 py-2.5 text-[12.5px] font-bold text-danger hover:bg-danger-bg disabled:opacity-60">Decline</button>
            <button type="button" disabled={busy} onClick={() => onDecision("approved", notes)} className="rounded-btn bg-primary px-5 py-2.5 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-60">Approve</button>
          </>
        )}
      </div>
    </Modal>
  );
}

function PayrollExportModal({
  weekStart,
  weekEnd,
  regularMinutes,
  overtimeMinutes,
  approved,
  total,
  ready,
  onClose,
}: {
  weekStart: string;
  weekEnd: string;
  regularMinutes: number;
  overtimeMinutes: number;
  approved: number;
  total: number;
  ready: boolean;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width={470}>
      <div className="flex items-start gap-3">
        <span className="flex-1">
          <span className="block text-[19px] font-extrabold text-ink">Export to payroll</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">Week of {dateLabel(weekStart)} – {dateLabel(weekEnd)}</span>
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full bg-canvas text-muted">×</button>
      </div>
      <div className={`rounded-[14px] border px-4 py-3 text-[12.5px] font-bold ${ready ? "border-[#CBE5D7] bg-[#E4F3EC] text-success" : "border-[#EFD9B5] bg-warning-bg text-warning-text"}`}>
        {ready ? `All ${total} entries approved ✓` : `${approved}/${total} closed entries approved — finish review before export`}
      </div>
      <div className="rounded-[14px] border border-hairline bg-canvas px-4 py-3">
        <Total label="Regular hours" value={hours(regularMinutes)} />
        <Total label="Overtime" value={hours(overtimeMinutes)} warn={overtimeMinutes > 0} />
        <Total label="Format" value="Generic payroll CSV" />
      </div>
      <p className="text-[11.5px] leading-normal text-faint">
        The export contains one row per clock entry with staff name, dates, hours, breaks, room, and approval status.
      </p>
      <div className="flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[12.5px] font-bold text-ink">Cancel</button>
        {ready ? (
          <a href={`/reports-export/timesheets?week=${weekStart}`} className="rounded-btn bg-primary px-5 py-2.5 text-[12.5px] font-bold text-white hover:bg-primary-hover">Download CSV</a>
        ) : (
          <button type="button" disabled className="rounded-btn bg-primary px-5 py-2.5 text-[12.5px] font-bold text-white opacity-50">Download CSV</button>
        )}
      </div>
    </Modal>
  );
}
