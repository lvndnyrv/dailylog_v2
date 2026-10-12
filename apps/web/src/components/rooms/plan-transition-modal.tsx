"use client";

import type {
  RoomLiveStatus,
  RoomTransition,
  RoomTransitionPlanRow,
  RoomTransitionWaitRow,
} from "@dailylog/db/queries";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import {
  completeRoomTransitionAction,
  cancelRoomTransitionAction,
  cancelRoomTransitionWaitAction,
  planRoomTransitionAction,
  type RoomActionState,
} from "@/lib/rooms/actions";
import { TransitionCapacityPreview } from "./transition-capacity-preview";

export function PlanTransitionModal({
  transition,
  plan,
  wait,
  rooms,
  today,
  onClose,
}: {
  transition: RoomTransition;
  plan?: RoomTransitionPlanRow;
  wait?: RoomTransitionWaitRow;
  rooms: RoomLiveStatus[];
  today: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    planRoomTransitionAction,
    {},
  );
  const [completion, completeAction, completing] = useActionState<RoomActionState, FormData>(
    completeRoomTransitionAction,
    {},
  );
  const [cancellation, cancelAction, cancelling] = useActionState<RoomActionState, FormData>(cancelRoomTransitionAction, {});
  const [waitCancellation, cancelWaitAction, cancellingWait] = useActionState<RoomActionState, FormData>(cancelRoomTransitionWaitAction, {});
  const [originalVersion] = useState(plan?.updated_at ?? wait?.updated_at ?? "");
  const [attempted, setAttempted] = useState(false);
  const busy = pending || completing || cancelling || cancellingWait;
  const close = () => { if (!busy) onClose(); };
  const suggestedDate = plan?.move_on ?? wait?.first_available_day ?? wait?.not_before ?? transitionDate(transition, today);
  const suggestedTransition = transitionWeekDates(suggestedDate);
  const [destinationId, setDestinationId] = useState(plan?.to_classroom_id ?? wait?.to_classroom_id ?? transition.next_room_id ?? "");
  const [moveOn, setMoveOn] = useState(suggestedDate);
  const [transitionWeek, setTransitionWeek] = useState(plan?.transition_week ?? suggestedTransition.startsOn >= today);
  const [visits, setVisits] = useState({
    startsOn: plan?.transition_starts_on ?? suggestedTransition.startsOn,
    endsOn: plan?.transition_ends_on ?? suggestedTransition.endsOn,
  });
  const destination = rooms.find((room) => room.id === destinationId);
  const destinationFull = destination?.capacity != null && destination.enrolled_count >= destination.capacity;
  const minimumMoveDate = [today, wait?.not_before, destination?.opens_on]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? today;

  useEffect(() => {
    if (completion.ok || cancellation.ok || waitCancellation.ok) onClose();
  }, [completion.ok, cancellation.ok, waitCancellation.ok, onClose]);

  return (
    <Modal onClose={close} width={470}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          Plan {transition.first_name}&apos;s move
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          {transition.room_name} → {destination?.name ?? "next room"}. Scheduling
          preserves the current room until the move day.
        </p>
      </div>

      {plan ? (
        <form
          action={completeAction}
          className="rounded-[13px] border border-[#CBE7D8] bg-[#F5FBF8] p-3.5"
          onSubmit={(event) => {
            if (!window.confirm(`Move ${transition.first_name} to the new room now?`)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="plan_id" value={plan.id} />
          <input type="hidden" name="updated_at" value={originalVersion} />
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted">
              On or after the planned day, complete the move to change the home room and tell the family. Capacity and live ratios are checked again.
            </span>
            <Button type="submit" className="shrink-0 px-3 py-2 text-[11.5px]" disabled={busy || state.ok || plan.move_on > today}>
              {completing ? "Moving…" : plan.move_on > today ? `Due ${plan.move_on}` : "Complete move"}
            </Button>
          </div>
          {completion.error ? <Notice tone="error">{completion.error}</Notice> : null}
        </form>
      ) : null}

      {wait ? (
        <div className="rounded-[13px] border border-[#EFCF94] bg-[#FFF9EF] p-3.5">
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <b className="block text-[12.5px] text-ink">Waiting for a spot</b>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
                Earliest requested date {wait.not_before}. {wait.first_available_day
                  ? `The first projected opening is ${wait.first_available_day}; review it below before scheduling.`
                  : wait.status_detail}
              </span>
            </span>
            {wait.needs_review && <span className="rounded-full bg-danger-bg px-2 py-1 text-[10px] font-bold text-danger">Needs review</span>}
          </div>
        </div>
      ) : null}

      <form action={action} onInvalidCapture={() => setAttempted(true)} className={`flex flex-col gap-4 ${attempted ? "[&_input:invalid]:border-danger [&_select:invalid]:border-danger" : ""}`}>
        <input type="hidden" name="child_id" value={transition.child_id} />
        <input type="hidden" name="from_room_id" value={transition.room_id} />
        {wait && <input type="hidden" name="to_room_id" value={wait.to_classroom_id} />}
        {wait && <><input type="hidden" name="wait_request_id" value={wait.id} /><input type="hidden" name="wait_updated_at" value={originalVersion} /></>}
        {plan && <><input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="updated_at" value={originalVersion} /></>}
        <fieldset disabled={busy || state.ok} className="flex min-w-0 flex-col gap-4">

        <div className="flex w-fit items-center gap-2 rounded-full border-[1.5px] border-[#D6E1F0] bg-canvas py-1.5 pl-1.5 pr-3.5">
          <span className="grid size-8 place-items-center rounded-full bg-[#E4F3EC] text-[11px] font-bold text-success">
            {transition.first_name[0]}{transition.last_name[0]}
          </span>
          <span className="text-[13px] font-bold text-ink">
            {transition.last_name} · {transition.first_name}
          </span>
        </div>

        <label className="flex min-w-0 flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">Destination room (required)</span>
          <select
            name="to_room_id"
            value={destinationId}
            onChange={(event) => setDestinationId(event.target.value)}
            disabled={Boolean(wait)}
            required
            className="min-w-0 w-full rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
          >
            <option value="" disabled>Choose a room</option>
            {rooms.filter((room) => room.id !== transition.room_id).map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
        </label>

        {destinationFull && <Notice tone="info">{destination?.name} is full today. You can plan a future move; a spot must be available before completing it.</Notice>}
        {destination?.opens_on && <p className="text-[12px] text-muted">Destination opens {destination.opens_on}.</p>}
        <Field label="Move day (required)" name="move_on" type="date" value={moveOn} required
          min={minimumMoveDate}
          onChange={(event) => {
            setMoveOn(event.target.value);
            if (event.target.value) setVisits(transitionWeekDates(event.target.value));
          }} />
        <TransitionCapacityPreview childId={transition.child_id} roomId={destinationId} from={moveOn < today ? today : moveOn} onChoose={(date) => {
          setMoveOn(date); setVisits(transitionWeekDates(date));
        }} />

        <label className="flex items-center gap-3 rounded-[13px] bg-canvas px-3.5 py-3">
          <span className="flex-1">
            <span className="block text-[13px] font-bold text-ink">Transition week</span>
            <span className="block text-[11.5px] text-muted">
              Morning visits to the new room during the week before.
            </span>
          </span>
          <input
            name="transition_week"
            type="checkbox"
            checked={transitionWeek}
            onChange={(event) => setTransitionWeek(event.target.checked)}
            className="size-4 accent-primary"
          />
        </label>

        {transitionWeek && <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Transition starts (required)"
            name="transition_starts_on"
            type="date"
            value={visits.startsOn}
            min={destination?.opens_on && destination.opens_on > today ? destination.opens_on : today}
            onChange={(event) => setVisits({ ...visits, startsOn: event.target.value })}
            required
          />
          <Field
            label="Transition ends (required)"
            name="transition_ends_on"
            type="date"
            value={visits.endsOn}
            min={visits.startsOn}
            max={moveOn ? new Date(new Date(`${moveOn}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10) : undefined}
            onChange={(event) => setVisits({ ...visits, endsOn: event.target.value })}
            required
          />
        </div>}

        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Current tuition / mo (reference)"
            name="current_tuition"
            type="number"
            min={0}
            step="0.01"
            defaultValue={plan?.current_tuition_cents == null ? "" : plan.current_tuition_cents / 100}
            placeholder="1320"
          />
          <Field
            label="Proposed tuition / mo"
            name="new_tuition"
            type="number"
            min={0}
            step="0.01"
            defaultValue={plan?.new_tuition_cents == null ? "" : plan.new_tuition_cents / 100}
            placeholder="1180"
          />
        </div>

        <Field
          label="Message to family (optional)"
          name="family_message"
          maxLength={2000}
          defaultValue={plan?.family_message ?? ""}
          placeholder={`${transition.first_name} is ready to move up — the new room is excited to welcome them.`}
        />

        <Field
          label="Plan note"
          name="notes"
          maxLength={2000}
          defaultValue={plan?.notes ?? wait?.notes ?? ""}
          placeholder="Family notified, gradual visits requested…"
        />

        <div className="rounded-[13px] bg-tint px-3.5 py-3 text-[12px] leading-relaxed text-ink">
          The old spot stays occupied until an admin completes the move. The family is notified
          when you save and sees the move day, transition visits, and the proposed rate in their app.
          Visits are a plan, not attendance or staffing assignments. A proposed rate is scheduled with this move and becomes the current rate only when the move is completed; existing invoices never change. Waitlist offers still require a separate Enrollment review.
        </div>
        </fieldset>

        {state.ok && <Notice tone="success"><b>{state.outcome === "waiting" ? "Added to the waiting queue." : "Move planned."}</b> Close to see it on the panel.</Notice>}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        {!plan && !wait && !state.ok && (
          <button
            type="submit"
            name="intent"
            value="wait"
            formNoValidate
            disabled={busy || !destinationId || !moveOn}
            className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[12px] font-bold text-primary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : "No suitable date? Keep waiting for a spot"}
          </button>
        )}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={close} disabled={busy}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={busy || state.ok}>
            {pending ? "Scheduling…" : wait ? "Review & schedule the move" : "Schedule the move"}
          </Button>
        </div>
      </form>
      {plan && <form action={cancelAction} onSubmit={(event) => {
        if (!window.confirm(`Cancel ${transition.first_name}'s planned move? Their current room will not change. The family will be notified.`)) event.preventDefault();
      }} className="border-t border-[#D6E1F0] pt-3">
        <input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="updated_at" value={originalVersion} />
        <Button type="submit" variant="secondary" disabled={busy || state.ok} className="w-full text-danger">{cancelling ? "Cancelling move…" : "Cancel planned move"}</Button>
        {cancellation.error && <Notice tone="error">{cancellation.error}</Notice>}
      </form>}
      {wait && <form action={cancelWaitAction} onSubmit={(event) => {
        if (!window.confirm(`Remove ${transition.first_name} from the room waiting queue?`)) event.preventDefault();
      }} className="border-t border-[#D6E1F0] pt-3">
        <input type="hidden" name="wait_request_id" value={wait.id} />
        <input type="hidden" name="wait_updated_at" value={originalVersion} />
        <Button type="submit" variant="secondary" disabled={busy || state.ok} className="w-full text-danger">
          {cancellingWait ? "Removing…" : "Remove waiting request"}
        </Button>
        {waitCancellation.error && <Notice tone="error">{waitCancellation.error}</Notice>}
      </form>}
    </Modal>
  );
}

function transitionWeekDates(moveOn: string): { startsOn: string; endsOn: string } {
  const moveDate = new Date(`${moveOn}T12:00:00Z`);
  const day = moveDate.getUTCDay() || 7;
  const monday = new Date(moveDate);
  monday.setUTCDate(moveDate.getUTCDate() - day - 6);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  return {
    startsOn: monday.toISOString().slice(0, 10),
    endsOn: friday.toISOString().slice(0, 10),
  };
}

function transitionDate(transition: RoomTransition, centerToday: string): string {
  if (!transition.date_of_birth) return centerToday;
  const date = new Date(`${transition.date_of_birth}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + Number(transition.max_age_months));
  const today = new Date(`${centerToday}T12:00:00Z`);
  if (date <= today) {
    today.setUTCDate(today.getUTCDate() + 7);
    while (today.getUTCDay() === 0 || today.getUTCDay() === 6) today.setUTCDate(today.getUTCDate() + 1);
    return today.toISOString().slice(0, 10);
  }
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
