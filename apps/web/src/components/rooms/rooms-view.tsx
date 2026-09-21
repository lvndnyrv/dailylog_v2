"use client";

import type { Tables } from "@dailylog/db";
import type {
  RoomCoverageAssignmentRow,
  RoomLiveStatus,
  RoomTransition,
  RoomTransitionPlanRow,
  RoomTransitionWaitRow,
  StaffShiftRow,
  StaffTimeEntryRow,
  StaffTimeOffRequestRow,
} from "@dailylog/db/queries";
import { isOverRatio } from "@dailylog/shared";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AssignFloaterModal } from "./assign-floater-modal";
import { CombineRoomsModal } from "./combine-rooms-modal";
import { OverRatioModal } from "./over-ratio-modal";
import { PlanTransitionModal } from "./plan-transition-modal";
import { RatioAlertsCard } from "./ratio-alerts-card";
import { RatioRulesModal } from "./ratio-rules-modal";
import { RoomFormModal } from "./room-form-modal";
import { CombinationControls, LiveRoomsRefresh } from "./combination-controls";
import { PlannedBreaks } from "./planned-breaks";
import { CoverageForecast } from "./coverage-forecast";

const card = "rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card";
const palette = ["#77AAE3", "#83C49F", "#A78AD7", "#E5A56E", "#6BAAC2"];

interface Floater {
  id: string;
  full_name: string;
  email: string;
}

interface Educator {
  id: string;
  staffMemberId: string;
  fullName: string;
  role: string;
  roomId: string | null;
}

type ModalState =
  | "none"
  | "add"
  | "rules"
  | "combine"
  | { kind: "assign"; educatorId: string | null; roomId: string | null }
  | { kind: "transition"; transition: RoomTransition }
  | { kind: "alert"; room: RoomLiveStatus };

export function RoomsView({
  rooms,
  floaters,
  transitions,
  transitionPlans,
  transitionWaits,
  combinations,
  coverageAssignments,
  shifts,
  timeEntries,
  timeOff,
  educators,
  date,
  timeZone,
  alertSettings,
  initialModal,
  initialCoverageDate,
  focusCoverageAssignmentId,
  openingHours,
}: {
  rooms: RoomLiveStatus[];
  floaters: Floater[];
  transitions: RoomTransition[];
  transitionPlans: RoomTransitionPlanRow[];
  transitionWaits: RoomTransitionWaitRow[];
  combinations: Tables<"room_combinations">[];
  coverageAssignments: RoomCoverageAssignmentRow[];
  shifts: StaffShiftRow[];
  timeEntries: StaffTimeEntryRow[];
  timeOff: StaffTimeOffRequestRow[];
  educators: Educator[];
  date: string;
  timeZone: string;
  alertSettings: { afterMinutes: number; notifyFloaters: boolean; blockCheckins: boolean };
  initialModal?: string;
  initialCoverageDate?: string;
  focusCoverageAssignmentId?: string;
  openingHours: { start: string; end: string };
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(() => {
    if (initialModal === "add" || initialModal === "rules" || initialModal === "combine") {
      return initialModal;
    }
    return "none";
  });

  const closeModal = () => {
    setModal("none");
    if (initialModal) router.replace("/rooms", { scroll: false });
  };
  const activeCombinationCount = combinations.filter((item) => item.enabled).length;

  return (
    <div className="grid flex-1 items-start gap-5 p-7 pt-[22px] xl:grid-cols-[minmax(0,1fr)_298px]">
      <LiveRoomsRefresh />
      <div className="flex min-w-0 flex-col gap-4">
        <CoverageTimeline
          rooms={rooms}
          shifts={shifts}
          assignments={coverageAssignments}
          combinations={combinations}
          timeEntries={timeEntries}
          timeOff={timeOff}
          date={date}
          timeZone={timeZone}
          onAlert={(room) => setModal({ kind: "alert", room })}
          openingHours={openingHours}
        />

        <PlannedBreaks shifts={shifts} date={date} timeZone={timeZone} />
        <CoverageForecast
          rooms={rooms}
          today={date}
          timeZone={timeZone}
          openingHours={openingHours}
          initialDate={initialCoverageDate}
          focusAssignmentId={focusCoverageAssignmentId}
        />

        <FloaterPool
          floaters={floaters}
          shifts={shifts}
          date={date}
          timeZone={timeZone}
          onAssign={(educatorId) =>
            setModal({ kind: "assign", educatorId, roomId: null })
          }
        />

        <TransitionsPanel
          transitions={transitions}
          plans={transitionPlans}
          waits={transitionWaits}
          rooms={rooms}
          onPlan={(transition) => setModal({ kind: "transition", transition })}
        />
      </div>

      <aside className="flex flex-col gap-4">
        <RatioRulesCard rooms={rooms} onEdit={() => setModal("rules")} />
        <RatioAlertsCard initial={alertSettings} />
        <section className={`${card} px-4 py-4`} aria-labelledby="combine-h">
          <div className="flex items-center gap-2">
            <h2 id="combine-h" className="text-[14px] font-extrabold text-ink">
              Open &amp; close
            </h2>
            {activeCombinationCount > 0 && (
              <span className="rounded-full bg-[#E4F3EC] px-2 py-0.5 text-[10.5px] font-bold text-success">
                {activeCombinationCount} scheduled
              </span>
            )}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            During an activated weekday window, children and eligible educators are counted together in the host room under the stricter ratio. Home rooms stay unchanged.
          </p>
          <button
            type="button"
            onClick={() => setModal("combine")}
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline"
          >
            {activeCombinationCount ? "Edit combinations" : "Set up combinations"} <ArrowRight size={13} />
          </button>
          <CombinationControls combinations={combinations} date={date} />
        </section>
      </aside>

      {modal === "add" && (
        <RoomFormModal
          rooms={rooms}
          educators={educators.map((item) => ({ id: item.id, fullName: item.fullName }))}
          onClose={closeModal}
        />
      )}
      {modal === "rules" && <RatioRulesModal rooms={rooms} onClose={closeModal} />}
      {modal === "combine" && (
        <CombineRoomsModal rooms={rooms} combinations={combinations} onClose={closeModal} />
      )}
      {typeof modal === "object" && modal.kind === "assign" && (
        <AssignFloaterModal
          floaters={floaters}
          rooms={rooms}
          shifts={shifts}
          initialEducatorId={modal.educatorId}
          initialRoomId={modal.roomId}
          date={date}
          timeZone={timeZone}
          onClose={closeModal}
        />
      )}
      {typeof modal === "object" && modal.kind === "transition" && (
        <PlanTransitionModal
          transition={modal.transition}
          today={date}
          plan={transitionPlans.find((plan) => plan.child_id === modal.transition.child_id)}
          wait={transitionWaits.find((wait) => wait.child_id === modal.transition.child_id)}
          rooms={rooms}
          onClose={closeModal}
        />
      )}
      {typeof modal === "object" && modal.kind === "alert" && (
        <OverRatioModal
          room={modal.room}
          afterMinutes={alertSettings.afterMinutes}
          onAssign={() =>
            setModal({ kind: "assign", educatorId: floaters[0]?.id ?? null, roomId: modal.room.id })
          }
          onCombine={() => setModal("combine")}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

function CoverageTimeline({
  rooms,
  shifts,
  assignments,
  combinations,
  timeEntries,
  timeOff,
  date,
  timeZone,
  onAlert,
  openingHours,
}: {
  rooms: RoomLiveStatus[];
  shifts: StaffShiftRow[];
  assignments: RoomCoverageAssignmentRow[];
  combinations: Tables<"room_combinations">[];
  timeEntries: StaffTimeEntryRow[];
  timeOff: StaffTimeOffRequestRow[];
  date: string;
  timeZone: string;
  onAlert: (room: RoomLiveStatus) => void;
  openingHours: { start: string; end: string };
}) {
  const windowStart = localTimeMinutes(openingHours.start);
  const windowEnd = localTimeMinutes(openingHours.end);
  const todayShifts = shifts.filter((shift) => shift.status === "published" && dateInZone(shift.starts_at, timeZone) === date);
  const todayAssignments = assignments.filter(
    (assignment) => dateInZone(assignment.starts_at, timeZone) === date,
  );
  const clockedIn = new Set(
    timeEntries
      .filter((entry) => dateInZone(entry.clocked_in_at, timeZone) === date && !entry.clocked_out_at)
      .map((entry) => entry.staff?.id)
      .filter(Boolean),
  );
  const away = new Set(
    timeOff
      .filter((request) => request.status === "approved" && request.starts_on <= date && request.ends_on >= date)
      .map((request) => request.staff?.id)
      .filter(Boolean),
  );

  return (
    <section className={`${card} overflow-hidden`} aria-labelledby="coverage-h">
      <div className="flex flex-wrap items-center gap-2 px-[18px] pb-3 pt-4">
        <h2 id="coverage-h" className="text-[15px] font-extrabold text-ink">Today&apos;s coverage</h2>
        <span className="text-[12px] text-faint">{openingHours.start.slice(0, 5)} – {openingHours.end.slice(0, 5)} · center hours</span>
        <span className="ml-auto flex items-center gap-3 text-[10.5px] text-muted">
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-[#77AAE3]" /> shift</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-[#A78AD7]" /> coverage</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] border border-dashed border-danger" /> over now</span>
        </span>
      </div>

      <div className="px-[18px] pb-[18px]">
        <div className="mb-2 grid grid-cols-[112px_minmax(0,1fr)] gap-2 text-[10px] font-semibold text-faint">
          <span />
          <div className="relative h-4">
            {Array.from({ length: Math.ceil((windowEnd - windowStart) / 120) }, (_, index) => windowStart + index * 120).map((minute) => (
              <span key={minute} className="absolute -translate-x-1/2" style={{ left: `${((minute - windowStart) / (windowEnd - windowStart)) * 100}%` }}>
                {String(Math.floor(minute / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {rooms.map((room) => {
            const roomShifts = todayShifts.filter(
              (shift) => (shift.classroom?.id ?? shift.staff?.profile?.classroom?.id) === room.id,
            );
            const roomAssignments = todayAssignments.filter(
              (assignment) => assignment.classroom?.id === room.id,
            );
            const roomCombinations = combinations.filter(
              (combination) => combination.enabled && combination.source_classroom_id === room.id &&
                ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()),
            );
            const lines = roomShifts.length + roomAssignments.length + roomCombinations.length;
            const present = Number(room.present_count);
            const ratio = room.operating?.live_ratio ?? room.ratio_children_per_educator;
            const over = ratio !== null && isOverRatio(present, room.educators.length, ratio);

            return (
              <div key={room.id} className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                <div className="self-center leading-tight">
                  <Link href={`/rooms/${room.id}`} className="block truncate text-[12px] font-extrabold text-ink hover:text-primary">{room.name}</Link>
                  {room.operating?.combination_id && <span className="mt-1 block text-[10px] text-primary">{room.operating.host_room_id === room.id ? `Combined · 1:${ratio}` : `In ${room.operating.host_room_name}`}</span>}
                  {over && (
                    <button type="button" onClick={() => onAlert(room)} className="mt-0.5 flex items-center gap-1 text-[9.5px] font-bold text-danger hover:underline">
                      <AlertTriangle size={10} /> over ratio now
                    </button>
                  )}
                </div>

                <div className="relative overflow-hidden rounded-[8px] bg-[#ECF3FB]" style={{ height: Math.max(26, lines * 25) }}>
                  {lines === 0 && (
                    <span className="absolute inset-0 grid place-items-center text-[10.5px] text-faint">No published coverage</span>
                  )}
                  {roomShifts.map((shift, index) => {
                    const isAway = away.has(shift.staff?.id);
                    return (
                      <TimelineBar
                        windowStart={windowStart} windowEnd={windowEnd}
                        key={shift.id}
                        start={minutesInZone(shift.starts_at, timeZone)}
                        end={minutesInZone(shift.ends_at, timeZone)}
                        row={index}
                        color={isAway ? "#CAD4E2" : palette[index % palette.length]}
                        label={`${firstName(shift.staff?.profile?.full_name)} · ${shortTime(shift.starts_at, timeZone)}–${shortTime(shift.ends_at, timeZone)}`}
                        muted={isAway}
                        title={isAway ? "Approved time off" : clockedIn.has(shift.staff?.id) ? "Clocked in" : "Published shift"}
                        checked={clockedIn.has(shift.staff?.id) && !isAway}
                        breakStart={shift.planned_break_starts_at ? minutesInZone(shift.planned_break_starts_at, timeZone) : undefined}
                        breakEnd={shift.planned_break_ends_at ? minutesInZone(shift.planned_break_ends_at, timeZone) : undefined}
                      />
                    );
                  })}
                  {roomAssignments.map((assignment, index) => (
                    <TimelineBar
                      windowStart={windowStart} windowEnd={windowEnd}
                      key={assignment.id}
                      start={minutesInZone(assignment.starts_at, timeZone)}
                      end={minutesInZone(assignment.ends_at, timeZone)}
                      row={roomShifts.length + index}
                      color={assignment.status === "declined" ? "#D98B8B" : "#A78AD7"}
                      label={`${firstName(assignment.staff?.profile?.full_name)} · ${assignment.status === "assigned" ? "awaiting acceptance" : assignment.status}`}
                      title={`${assignment.status === "assigned" ? "Invitation pending" : assignment.status === "declined" ? "Coverage declined — arrange replacement" : "Coverage accepted"} · ${assignment.notes ?? "Time-bound room coverage"}`}
                      muted={assignment.status === "declined"}
                    />
                  ))}
                  {roomCombinations.map((combination, index) => {
                    const host = rooms.find((item) => item.id === combination.host_classroom_id)?.name ?? "host room";
                    return (
                      <TimelineBar
                        windowStart={windowStart} windowEnd={windowEnd}
                        key={combination.id}
                        start={localTimeMinutes(combination.starts_at)}
                        end={localTimeMinutes(combination.ends_at)}
                        row={roomShifts.length + roomAssignments.length + index}
                        color="#F2D49B"
                        label={`${combination.paused_on === date ? "Paused" : combination.activated_at ? "Combined" : "Plan"} in ${host}`}
                        title={`${combination.period} · ${combination.paused_on === date ? "paused today" : combination.activated_at ? "weekday shared-room schedule" : "save to activate this legacy plan"}`}
                      />
                    );
                  })}
                  {over && <span className="pointer-events-none absolute inset-0 rounded-[8px] border border-dashed border-danger" />}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
          Published shifts and coverage invitations; striped segments are planned breaks, not actual clock-outs. Live ratio state comes from check-ins and eligible staff presence. Untimed payroll breaks are not guessed.
        </p>
      </div>
    </section>
  );
}

function TimelineBar({
  start,
  end,
  row,
  color,
  label,
  title,
  muted = false,
  checked = false,
  windowStart,
  windowEnd,
  breakStart,
  breakEnd,
}: {
  start: number;
  end: number;
  row: number;
  color: string;
  label: string;
  title: string;
  muted?: boolean;
  checked?: boolean;
  windowStart: number;
  windowEnd: number;
  breakStart?: number;
  breakEnd?: number;
}) {
  const boundedStart = Math.max(windowStart, start);
  const boundedEnd = Math.min(windowEnd, end);
  if (boundedEnd <= boundedStart) return null;
  const left = ((boundedStart - windowStart) / (windowEnd - windowStart)) * 100;
  const width = ((boundedEnd - boundedStart) / (windowEnd - windowStart)) * 100;
  return (
    <span
      className={`absolute flex h-[21px] items-center truncate rounded-[7px] px-2 text-[9.5px] font-bold text-white ${muted ? "line-through" : ""}`}
      style={{ left: `${left}%`, width: `${width}%`, top: row * 25 + 2, backgroundColor: color }}
      title={title}
    >
      {checked && <Check size={10} className="mr-1 shrink-0" />} {label}
      {breakStart !== undefined && breakEnd !== undefined && Math.min(breakEnd, boundedEnd) > Math.max(breakStart, boundedStart) && <span aria-label="Planned break" title="Planned break" className="absolute inset-y-0 border-x border-white" style={{ left: `${Math.max(0, (breakStart - boundedStart) / (boundedEnd - boundedStart) * 100)}%`, width: `${(Math.min(breakEnd, boundedEnd) - Math.max(breakStart, boundedStart)) / (boundedEnd - boundedStart) * 100}%`, background: "repeating-linear-gradient(135deg,#FBF3E4 0px,#FBF3E4 3px,#B0782B 3px,#B0782B 5px)" }} />}
    </span>
  );
}

function FloaterPool({
  floaters,
  shifts,
  date,
  timeZone,
  onAssign,
}: {
  floaters: Floater[];
  shifts: StaffShiftRow[];
  date: string;
  timeZone: string;
  onAssign: (id: string) => void;
}) {
  return (
    <section className={`${card} px-[18px] py-4`} aria-labelledby="floaters-h">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 id="floaters-h" className="text-[15px] font-extrabold text-ink">Floater pool</h2>
        <span className="text-[11px] text-faint">not assigned to a home room — cover breaks, gaps and sick days</span>
      </div>
      {floaters.length === 0 ? (
        <p className="text-[12px] text-faint">No unassigned educators are available today.</p>
      ) : (
        <div className="divide-y divide-[#EDF3FB]">
          {floaters.map((floater) => {
            const shift = shifts.find(
              (item) => item.staff?.profile?.id === floater.id && dateInZone(item.starts_at, timeZone) === date,
            );
            return (
              <div key={floater.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <Avatar name={floater.full_name} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink">{floater.full_name}</span>
                  <span className="block text-[11px] text-muted">
                    {shift ? `Scheduled ${shortTime(shift.starts_at, timeZone)}–${shortTime(shift.ends_at, timeZone)}` : "No published shift today"}
                  </span>
                </span>
                <button type="button" onClick={() => onAssign(floater.id)} className="rounded-full bg-primary px-4 py-2 text-[11.5px] font-bold text-white hover:bg-primary-hover">
                  Send to a room
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TransitionsPanel({
  transitions,
  plans,
  waits,
  rooms,
  onPlan,
}: {
  transitions: RoomTransition[];
  plans: RoomTransitionPlanRow[];
  waits: RoomTransitionWaitRow[];
  rooms: RoomLiveStatus[];
  onPlan: (transition: RoomTransition) => void;
}) {
  const waitingChildren = new Set(waits.map((wait) => wait.child_id));
  const candidates = transitions.filter((transition) => !waitingChildren.has(transition.child_id));
  const count = waits.length + candidates.length;
  return (
    <section id="room-transitions" className={`${card} px-[18px] py-4`} aria-labelledby="transitions-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="transitions-h" className="text-[15px] font-extrabold text-ink">Upcoming transitions</h2>
        {count > 0 && (
          <span className="rounded-full bg-tint px-2 py-0.5 text-[10.5px] font-bold text-primary">
            {count} candidates, waits &amp; saved plans
          </span>
        )}
      </div>
      <p className="mb-3 mt-1 text-[11px] leading-relaxed text-faint">
        Birthday candidates for the next 90 days, persistent waiting requests, and all saved plans. Waiting does not reserve a place; review the projected opening before scheduling.
      </p>
      {count === 0 ? (
        <p className="text-[12px] text-faint">No room transitions are due in the next three months.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {waits.map((wait) => {
            const transition = waitToTransition(wait);
            return (
              <div key={wait.id} className="flex items-center gap-3 rounded-[12px] border border-[#E3EBF5] bg-[#FAFCFF] px-3 py-2.5">
                <Avatar name={`${wait.first_name} ${wait.last_name}`} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink">{wait.first_name} {wait.last_name}</span>
                  <span className="block text-[11px] text-muted">
                    {wait.from_room_name} → {wait.to_room_name} · {wait.first_available_day
                      ? `projected opening ${formatDate(wait.first_available_day)}`
                      : wait.status_detail}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${wait.needs_review ? "bg-danger-bg text-danger" : "bg-[#EDF2F9] text-muted"}`}>
                    {wait.needs_review ? "Needs review" : "Waiting for a spot"}
                  </span>
                  <button type="button" onClick={() => onPlan(transition)} className="text-[11px] font-bold text-primary hover:underline">
                    {wait.first_available_day ? "Review & plan" : "Review request"}
                  </button>
                </span>
              </div>
            );
          })}
          {candidates.map((transition) => {
            const plan = plans.find((item) => item.child_id === transition.child_id);
            const destination = rooms.find((room) => room.id === transition.next_room_id);
            const destinationFull = Boolean(
              destination?.capacity !== null &&
              destination?.capacity !== undefined &&
              Number(destination.enrolled_count) >= destination.capacity,
            );
            const waiting = !transition.next_room_id || destinationFull;
            return (
              <div
                key={transition.child_id}
                className={`flex items-center gap-3 rounded-[12px] border px-3 py-2.5 ${
                  plan
                    ? "border-[#CBE7D8] bg-[#F5FBF8]"
                    : waiting
                      ? "border-[#EFCF94] bg-[#FFF9EF]"
                      : "border-[#E3EBF5] bg-[#FAFCFF]"
                }`}
              >
                <Avatar name={`${transition.first_name} ${transition.last_name}`} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink">{transition.first_name} {transition.last_name}</span>
                  <span className="block text-[11px] text-muted">
                    {transition.room_name} → {transition.next_room_name ?? "destination needed"} · {transitionThreshold(transition)}
                  </span>
                </span>
                {plan ? (
                  <button type="button" onClick={() => onPlan(transition)} className="rounded-full bg-[#E4F3EC] px-3 py-1.5 text-[11px] font-bold text-success hover:bg-[#D7EDE3]">
                    Planned · {formatDate(plan.move_on)}
                  </button>
                ) : (
                  <span className="flex flex-col items-end gap-1">
                  {destinationFull && <span className="text-[10px] text-[#A86D13]">Full today · choose a later date</span>}
                  <button type="button" onClick={() => onPlan(transition)} className="rounded-full border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-[11.5px] font-bold text-primary hover:bg-canvas">
                    {transition.next_room_id ? "Plan a move" : "Choose destination"}
                  </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {count > 0 && (
        <p className="mt-3 border-t border-[#EDF3FB] pt-3 text-[10.5px] leading-relaxed text-faint">
          A waiting request is staff-only and does not reserve capacity or notify the family. A planned move keeps the current room through move day; the home room changes only when an admin completes it.
        </p>
      )}
    </section>
  );
}

function waitToTransition(wait: RoomTransitionWaitRow): RoomTransition {
  return {
    child_id: wait.child_id,
    first_name: wait.first_name,
    last_name: wait.last_name,
    date_of_birth: wait.date_of_birth,
    age_months: wait.age_months,
    room_id: wait.from_classroom_id,
    room_name: wait.from_room_name,
    max_age_months: wait.source_max_age_months,
    next_room_id: wait.to_classroom_id,
    next_room_name: wait.to_room_name,
  };
}

function RatioRulesCard({ rooms, onEdit }: { rooms: RoomLiveStatus[]; onEdit: () => void }) {
  return (
    <section className={`${card} px-4 py-4`} aria-labelledby="rules-h">
      <h2 id="rules-h" className="text-[14px] font-extrabold text-ink">Ratio rules</h2>
      <div className="mt-2.5 flex flex-col gap-2">
        {rooms.map((room) => (
          <div key={room.id} className="flex gap-2 text-[11.5px]">
            <span className="min-w-0 flex-1 truncate text-muted">
              {room.name}{room.min_age_months !== null && room.max_age_months !== null ? ` · ${formatBand(room.min_age_months, room.max_age_months)}` : ""}
            </span>
            <b className="text-ink">1 : {room.ratio_children_per_educator ?? "—"}</b>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
        Live counts use eligible educators in their current room, including temporary cover and clock-ins when enabled.
      </p>
      <button type="button" onClick={onEdit} className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline">
        Edit the rules <ArrowRight size={13} />
      </button>
    </section>
  );
}

function dateInZone(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function minutesInZone(value: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function localTimeMinutes(value: string): number {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function shortTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value)).replace(" ", "");
}

function firstName(value?: string): string {
  return value?.split(" ")[0] ?? "Staff";
}

function formatAge(months: number): string {
  return `${Math.floor(months / 12)}y ${months % 12}m`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function transitionThreshold(transition: RoomTransition): string {
  if (!transition.date_of_birth) return formatAge(transition.age_months);
  const date = new Date(`${transition.date_of_birth}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + transition.max_age_months);
  const threshold = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(date);
  return `turns ${formatTransitionAge(transition.max_age_months)} on ${threshold}`;
}

function formatTransitionAge(months: number): string {
  if (months < 24) return `${months} mo`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return remainder ? `${years}y ${remainder}m` : `${years}y`;
}

function formatBand(min: number, max: number): string {
  const label = (months: number) => months < 24 ? `${months} mo` : `${Math.floor(months / 12)} y`;
  return `${label(min)}–${label(max)}`;
}
