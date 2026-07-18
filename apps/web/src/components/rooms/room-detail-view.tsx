"use client";

import type { Tables } from "@dailylog/db";
import type {
  RoomCoverageAssignmentRow,
  RoomLiveStatus,
  RoomTransition,
  RoomTransitionPlanRow,
  StaffShiftRow,
  StaffTimeEntryRow,
  StaffTimeOffRequestRow,
} from "@dailylog/db/queries";
import { formatAge, isOverRatio } from "@dailylog/shared";
import { AlertTriangle, ArrowLeft, CalendarClock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AssignFloaterModal } from "./assign-floater-modal";
import { OverRatioModal } from "./over-ratio-modal";
import { PlanTransitionModal } from "./plan-transition-modal";
import { RoomFormModal } from "./room-form-modal";

const card = "rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";
const th = "text-[10.5px] font-bold tracking-[.07em] text-faint";

interface RosterChild {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  allergies: string[] | null;
  attendance: {
    checked_in_at: string | null;
    checked_out_at: string | null;
    status: string;
    absence_reason: string | null;
  }[];
}

type ModalState =
  | "none"
  | "edit"
  | "assign"
  | "alert"
  | { kind: "transition"; transition: RoomTransition };

export function RoomDetailView({
  room,
  rooms,
  roster,
  shifts,
  timeEntries,
  timeOff,
  assignments,
  transitions,
  transitionPlans,
  combinations,
  floaters,
  educators,
  date,
  timeZone,
  alertAfterMinutes,
}: {
  room: RoomLiveStatus;
  rooms: RoomLiveStatus[];
  roster: RosterChild[];
  shifts: StaffShiftRow[];
  timeEntries: StaffTimeEntryRow[];
  timeOff: StaffTimeOffRequestRow[];
  assignments: RoomCoverageAssignmentRow[];
  transitions: RoomTransition[];
  transitionPlans: RoomTransitionPlanRow[];
  combinations: Tables<"room_combinations">[];
  floaters: { id: string; full_name: string; email: string }[];
  educators: { id: string; fullName: string }[];
  date: string;
  timeZone: string;
  alertAfterMinutes: number;
}) {
  const [modal, setModal] = useState<ModalState>("none");
  const present = Number(room.present_count);
  const activeCoverage = assignments.filter(
    (item) => new Date(item.starts_at) <= new Date() && new Date(item.ends_at) >= new Date(),
  );
  const inNow = roster.filter(
    (child) => child.attendance[0]?.checked_in_at && !child.attendance[0]?.checked_out_at,
  ).length;
  const roomShifts = shifts.filter(
    (shift) =>
      dateInZone(shift.starts_at, timeZone) === date &&
      (shift.classroom?.id ?? shift.staff?.profile?.classroom?.id) === room.id,
  );
  const away = new Set(
    timeOff
      .filter((request) => request.status === "approved" && request.starts_on <= date && request.ends_on >= date)
      .map((request) => request.staff?.id)
      .filter(Boolean),
  );
  const clockedIn = new Set(
    timeEntries
      .filter((entry) => dateInZone(entry.clocked_in_at, timeZone) === date && !entry.clocked_out_at)
      .map((entry) => entry.staff?.id)
      .filter(Boolean),
  );
  const awayProfiles = new Set(
    roomShifts
      .filter((shift) => away.has(shift.staff?.id))
      .map((shift) => shift.staff?.profile?.id)
      .filter(Boolean),
  );
  const countedEducators = new Set([
    ...room.educators.map((item) => item.id).filter((id) => !awayProfiles.has(id)),
    ...activeCoverage.map((item) => item.staff?.profile?.id).filter(Boolean),
  ]).size;
  const over = room.ratio_children_per_educator !== null &&
    isOverRatio(present, countedEducators, room.ratio_children_per_educator);
  const requiredEducators = room.ratio_children_per_educator
    ? Math.max(1, Math.ceil(present / room.ratio_children_per_educator))
    : 0;
  const gapAt = findCoverageGap(roomShifts, assignments, away, requiredEducators, timeZone);

  return (
    <>
      <header className="border-b-[1.5px] border-hairline bg-card px-7 py-[18px]">
        <Link href="/rooms" className="mb-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted hover:text-primary">
          <ArrowLeft size={13} /> Rooms &amp; ratios
        </Link>
        <div className="flex items-center gap-3.5">
          <span className="grid size-[44px] flex-none place-items-center rounded-full bg-tint text-[16px] font-extrabold text-primary">
            {room.name[0]}
          </span>
          <span className="min-w-0">
            <span className="block text-[20px] font-extrabold text-ink">{room.name}</span>
            <span className="block text-[12px] text-muted">
              {room.min_age_months !== null && room.max_age_months !== null ? `${room.min_age_months}–${room.max_age_months} mo · ` : ""}
              {room.capacity ? `capacity ${room.capacity} · ` : ""}
              {room.enrolled_count} enrolled · {inNow} in right now
            </span>
          </span>
          <span className="flex-1" />
          {transitions.length > 0 ? (
            <a href="#room-transitions" className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-[18px] py-2.5 text-[13px] font-bold text-ink hover:bg-canvas">
              Plan a transition
            </a>
          ) : (
            <Link href="/rooms#room-transitions" className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-[18px] py-2.5 text-[13px] font-bold text-ink hover:bg-canvas">
              View transitions
            </Link>
          )}
          <button type="button" onClick={() => setModal("edit")} className="rounded-full bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover">
            Edit room
          </button>
        </div>
      </header>

      <main className="grid flex-1 items-start gap-5 p-7 pt-[22px] xl:grid-cols-[minmax(0,1fr)_298px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={`${card} ${over ? "border-[#EFC3C3] bg-danger-bg/35" : ""}`} aria-labelledby="ratio-h">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <h2 id="ratio-h" className={cardTitle}>Live ratio</h2>
                <span className="text-[12px] text-muted">
                  {countedEducators} educator{countedEducators === 1 ? "" : "s"} · {present} children
                  {room.ratio_children_per_educator !== null ? ` · licensed 1 : ${room.ratio_children_per_educator}` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => over && setModal("alert")}
                className={`rounded-full px-3 py-1 text-[11.5px] font-bold ${over ? "bg-danger text-white" : "bg-[#E4F3EC] text-success"}`}
              >
                {over ? "Fix coverage" : "In ratio"}
              </button>
            </div>
            {gapAt && !over ? (
              <button type="button" onClick={() => setModal("assign")} className="mt-3 flex w-full items-center gap-2 rounded-[12px] border border-[#EFCF94] bg-[#FFF8EA] px-3 py-2.5 text-left">
                <AlertTriangle size={14} className="text-[#A86D13]" />
                <span className="flex-1 text-[11.5px] text-ink">Using today&apos;s live attendance, scheduled coverage drops below {requiredEducators} educators at <b>{gapAt}</b>.</span>
                <span className="font-bold text-primary">Assign cover</span>
              </button>
            ) : (
              <p className="mt-2 text-[11px] text-faint">Live counts include home-room educators and active time-bound coverage.</p>
            )}
          </section>

          <section className={card} aria-labelledby="educators-h">
            <div className="mb-3 flex items-baseline gap-2">
              <h2 id="educators-h" className={cardTitle}>Educators today</h2>
              <span className="text-[11px] text-faint">published shifts and temporary coverage</span>
            </div>
            {roomShifts.length === 0 && assignments.length === 0 ? (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-[12px] text-faint">No scheduled coverage is published for this room today.</p>
                <button type="button" onClick={() => setModal("assign")} className="rounded-full bg-primary px-4 py-2 text-[11.5px] font-bold text-white">Assign coverage</button>
              </div>
            ) : (
              <div className="divide-y divide-[#EDF3FB]">
                {roomShifts.map((shift) => {
                  const isAway = away.has(shift.staff?.id);
                  const active = clockedIn.has(shift.staff?.id);
                  return (
                    <div key={shift.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                      <Avatar name={shift.staff?.profile?.full_name ?? "Staff"} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[12.5px] font-bold text-ink ${isAway ? "line-through opacity-60" : ""}`}>{shift.staff?.profile?.full_name ?? "Staff member"}</span>
                        <span className="block text-[11px] text-muted">{shortTime(shift.starts_at, timeZone)}–{shortTime(shift.ends_at, timeZone)}{shift.unpaid_break_minutes ? ` · ${shift.unpaid_break_minutes} min break` : ""}</span>
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${isAway ? "bg-[#EDF1F6] text-muted" : active ? "bg-[#E4F3EC] text-success" : "bg-tint text-primary"}`}>
                        {isAway ? "Away" : active ? "Clocked in" : "Scheduled"}
                      </span>
                    </div>
                  );
                })}
                {assignments.map((assignment) => (
                  <div key={assignment.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                    <Avatar name={assignment.staff?.profile?.full_name ?? "Coverage"} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold text-ink">{assignment.staff?.profile?.full_name ?? "Coverage staff"}</span>
                      <span className="block text-[11px] text-muted">{shortTime(assignment.starts_at, timeZone)}–{shortTime(assignment.ends_at, timeZone)}{assignment.notes ? ` · ${assignment.notes}` : ""}</span>
                    </span>
                    <span className="rounded-full bg-[#EEE8FA] px-2.5 py-1 text-[10.5px] font-bold text-[#7654AD]">Coverage</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <RosterTable roster={roster} inNow={inNow} timeZone={timeZone} transitions={transitions} plans={transitionPlans} rooms={rooms} />
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-labelledby="settings-h">
            <h2 id="settings-h" className={`${cardTitle} mb-3`}>Room settings</h2>
            <dl className="flex flex-col gap-2.5">
              <SettingRow label="Age band">{room.min_age_months !== null && room.max_age_months !== null ? `${room.min_age_months}–${room.max_age_months} months` : "—"}</SettingRow>
              <SettingRow label="Capacity">{room.capacity ?? "—"}</SettingRow>
              <SettingRow label="Ratio">{room.ratio_children_per_educator ? `1 : ${room.ratio_children_per_educator}` : "—"}</SettingRow>
              <SettingRow label="Lead educator">{educators.find((item) => item.id === room.lead_educator_id)?.fullName ?? "Not assigned"}</SettingRow>
              <SettingRow label="Nap window">{room.nap_start && room.nap_end ? `${room.nap_start.slice(0, 5)}–${room.nap_end.slice(0, 5)}` : "Not set"}</SettingRow>
              <SettingRow label="Opens">{room.opens_on ? formatDate(room.opens_on) : "Open now"}</SettingRow>
              <SettingRow label="Combined rooms">{combinationLabel(combinations, rooms)}</SettingRow>
            </dl>
            <Link href="/rooms?modal=combine" className="mt-3 block text-[12px] font-bold text-primary hover:underline">Edit open &amp; close combinations →</Link>
            <button type="button" onClick={() => setModal("edit")} className="mt-3 text-[12px] font-bold text-primary hover:underline">Edit room settings →</button>
          </section>

          <section id="room-transitions" className={card} aria-labelledby="transition-h">
            <div className="mb-3 flex items-center gap-2">
              <CalendarClock size={15} className="text-primary" />
              <h2 id="transition-h" className={cardTitle}>Upcoming transitions</h2>
              <Link href="/rooms#room-transitions" className="ml-auto text-[11px] font-bold text-primary hover:underline">All</Link>
            </div>
            {transitions.length === 0 ? (
              <p className="text-[11.5px] leading-relaxed text-faint">No children are aging out of this room in the next three months.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {transitions.map((transition) => {
                  const plan = transitionPlans.find((item) => item.child_id === transition.child_id);
                  const destination = rooms.find((item) => item.id === transition.next_room_id);
                  const destinationFull = Boolean(
                    destination?.capacity !== null &&
                    destination?.capacity !== undefined &&
                    Number(destination.enrolled_count) >= destination.capacity,
                  );
                  return (
                    <div key={transition.child_id} className="border-b border-[#EDF3FB] pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={`${transition.first_name} ${transition.last_name}`} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-bold text-ink">{transition.first_name} {transition.last_name}</span>
                          <span className="block text-[10.5px] text-muted">→ {transition.next_room_name ?? "destination needed"} · {Math.floor(transition.age_months / 12)}y {transition.age_months % 12}m</span>
                        </span>
                      </div>
                      {plan || (transition.next_room_id && !destinationFull) ? (
                        <button type="button" onClick={() => setModal({ kind: "transition", transition })} className="mt-2 w-full rounded-full border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-canvas">
                          {plan ? `Planned · ${formatDate(plan.move_on)}` : "Plan the move"}
                        </button>
                      ) : (
                        <span className="mt-2 block w-full rounded-full bg-[#FFF0D6] px-3 py-1.5 text-center text-[10.5px] font-bold text-[#A86D13]">
                          {destinationFull ? "Waiting for a spot" : "Destination needed"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </main>

      {modal === "edit" && <RoomFormModal room={room} rooms={rooms} educators={educators} onClose={() => setModal("none")} />}
      {modal === "assign" && (
        <AssignFloaterModal floaters={floaters} rooms={rooms} shifts={shifts} initialEducatorId={floaters[0]?.id ?? null} initialRoomId={room.id} date={date} timeZone={timeZone} onClose={() => setModal("none")} />
      )}
      {modal === "alert" && (
        <OverRatioModal room={room} afterMinutes={alertAfterMinutes} onAssign={() => setModal("assign")} onCombine={() => window.location.assign("/rooms?modal=combine")} onClose={() => setModal("none")} />
      )}
      {typeof modal === "object" && modal.kind === "transition" && (
        <PlanTransitionModal transition={modal.transition} plan={transitionPlans.find((item) => item.child_id === modal.transition.child_id)} rooms={rooms} onClose={() => setModal("none")} />
      )}
    </>
  );
}

function RosterTable({
  roster,
  inNow,
  timeZone,
  transitions,
  plans,
  rooms,
}: {
  roster: RosterChild[];
  inNow: number;
  timeZone: string;
  transitions: RoomTransition[];
  plans: RoomTransitionPlanRow[];
  rooms: RoomLiveStatus[];
}) {
  return (
    <section className={card} aria-labelledby="roster-h">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="roster-h" className={cardTitle}>Roster</h2>
        <span className="text-[11px] text-faint">{inNow} of {roster.length} in · select a child for their profile</span>
      </div>
      <div className={`grid grid-cols-[1.6fr_.7fr_1fr_1.4fr] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
        <span>CHILD</span><span>AGE</span><span>TODAY</span><span>NOTES</span>
      </div>
      {roster.map((child) => {
        const attendance = child.attendance[0];
        const state = !attendance ? "No record" : attendance.status === "absent" || attendance.status === "excused" ? "Out today" : attendance.checked_out_at ? `Out ${timeOf(attendance.checked_out_at, timeZone)}` : attendance.checked_in_at ? `In since ${timeOf(attendance.checked_in_at, timeZone)}` : "Expected";
        const transition = transitions.find((item) => item.child_id === child.id);
        const plan = plans.find((item) => item.child_id === child.id);
        const destination = rooms.find((item) => item.id === transition?.next_room_id);
        const waiting = Boolean(
          transition &&
          (!transition.next_room_id ||
            (destination?.capacity !== null &&
              destination?.capacity !== undefined &&
              Number(destination.enrolled_count) >= destination.capacity)),
        );
        return (
          <Link key={child.id} href={`/children/${child.id}`} className={`grid grid-cols-[1.6fr_.7fr_1fr_1.4fr] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0 hover:bg-[#F8FBFE] ${state === "Out today" ? "bg-[#FFFBF4]" : ""}`}>
            <span className="flex items-center gap-2.5"><Avatar name={`${child.first_name} ${child.last_name}`} size={28} /><span className="text-[12.5px] font-bold text-ink">{child.first_name} {child.last_name}</span></span>
            <span className="text-[12px] text-muted">{child.date_of_birth ? formatAge(child.date_of_birth) : "—"}</span>
            <span className={`text-[12px] ${state.startsWith("In") ? "font-semibold text-success" : "text-muted"}`}>{state}</span>
            <span className="truncate text-[12px] text-muted">
              {transition ? (
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[10.5px] font-bold ${plan ? "bg-[#E4F3EC] text-success" : "bg-tint text-primary"}`}>
                  → {transition.next_room_name ?? "Next room"}{plan ? ` · ${formatDate(plan.move_on)}` : waiting ? " · waiting for spot" : " · needs plan"}
                </span>
              ) : (child.allergies?.length ?? 0) > 0 ? (
                <span className="font-semibold text-danger">{child.allergies!.join(", ")}</span>
              ) : attendance?.absence_reason ?? "—"}
            </span>
          </Link>
        );
      })}
      {roster.length === 0 && <p className="pt-3 text-[12px] text-faint">No children in this room yet.</p>}
    </section>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-[11.5px] text-muted">{label}</dt><dd className="text-right text-[11.5px] font-semibold text-ink">{children}</dd></div>;
}

function findCoverageGap(shifts: StaffShiftRow[], assignments: RoomCoverageAssignmentRow[], away: Set<string | null | undefined>, required: number, timeZone: string): string | null {
  if (required < 1) return null;
  const intervals = [
    ...shifts.filter((shift) => !away.has(shift.staff?.id)).map((shift) => [minutesInZone(shift.starts_at, timeZone), minutesInZone(shift.ends_at, timeZone)]),
    ...assignments.map((assignment) => [minutesInZone(assignment.starts_at, timeZone), minutesInZone(assignment.ends_at, timeZone)]),
  ];
  if (intervals.length === 0) return null;
  const start = Math.min(...intervals.map((item) => item[0]));
  const end = Math.max(...intervals.map((item) => item[1]));
  let hadCoverage = false;
  for (let minute = start; minute < end; minute += 15) {
    const count = intervals.filter(([from, to]) => from <= minute && to > minute).length;
    if (count >= required) hadCoverage = true;
    else if (hadCoverage) return minuteLabel(minute);
  }
  return null;
}

function combinationLabel(combinations: Tables<"room_combinations">[], rooms: RoomLiveStatus[]): string {
  const active = combinations.filter((item) => item.enabled);
  if (active.length === 0) return "None";
  return active.map((item) => {
    const source = rooms.find((room) => room.id === item.source_classroom_id)?.name ?? "Room";
    const host = rooms.find((room) => room.id === item.host_classroom_id)?.name ?? "room";
    return `${source} → ${host}`;
  }).join(", ");
}

function dateInZone(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function minutesInZone(value: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  return Number(parts.find((item) => item.type === "hour")?.value ?? 0) * 60 + Number(parts.find((item) => item.type === "minute")?.value ?? 0);
}

function shortTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value)).replace(" ", "");
}

function timeOf(timestamp: string, timeZone: string): string {
  return new Date(timestamp).toLocaleTimeString("en-CA", { timeZone, hour: "numeric", minute: "2-digit" });
}

function minuteLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour > 12 ? hour - 12 : hour}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}
