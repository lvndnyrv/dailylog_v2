"use client";

import type {
  RoomLiveStatus,
  RoomTransition,
  RoomTransitionPlanRow,
} from "@dailylog/db/queries";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { planRoomTransitionAction, type RoomActionState } from "@/lib/rooms/actions";

export function PlanTransitionModal({
  transition,
  plan,
  rooms,
  onClose,
}: {
  transition: RoomTransition;
  plan?: RoomTransitionPlanRow;
  rooms: RoomLiveStatus[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    planRoomTransitionAction,
    {},
  );
  const suggestedDate = plan?.move_on ?? transitionDate(transition);

  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          Plan {transition.first_name}&apos;s move
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          {transition.room_name} → {transition.next_room_name ?? "next room"}. Scheduling
          preserves the current room until the move day.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="child_id" value={transition.child_id} />
        <input type="hidden" name="from_room_id" value={transition.room_id} />

        <div className="flex w-fit items-center gap-2 rounded-full border-[1.5px] border-[#D6E1F0] bg-canvas py-1.5 pl-1.5 pr-3.5">
          <span className="grid size-8 place-items-center rounded-full bg-[#E4F3EC] text-[11px] font-bold text-success">
            {transition.first_name[0]}{transition.last_name[0]}
          </span>
          <span className="text-[13px] font-bold text-ink">
            {transition.last_name} · {transition.first_name}
          </span>
        </div>

        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">Destination room</span>
          <select
            name="to_room_id"
            defaultValue={plan?.to_classroom_id ?? transition.next_room_id ?? ""}
            required
            className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
          >
            <option value="" disabled>Choose a room</option>
            {rooms.filter((room) => room.id !== transition.room_id).map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
        </label>

        <Field label="Move day" name="move_on" type="date" defaultValue={suggestedDate} required />

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
            defaultChecked={plan?.transition_week ?? true}
            className="size-4 accent-primary"
          />
        </label>

        <Field
          label="Plan note"
          name="notes"
          defaultValue={plan?.notes ?? ""}
          placeholder="Family notified, gradual visits requested…"
        />

        <div className="rounded-[13px] bg-tint px-3.5 py-3 text-[12px] leading-relaxed text-ink">
          The old spot stays occupied until the move date. Waitlist and billing
          automation will consume this plan when those integrations are enabled.
        </div>

        {state.ok && <Notice tone="success"><b>Move planned.</b> Close to see it on the panel.</Notice>}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Scheduling…" : "Schedule the move"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function transitionDate(transition: RoomTransition): string {
  if (!transition.date_of_birth) return new Date().toISOString().slice(0, 10);
  const date = new Date(`${transition.date_of_birth}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + Number(transition.max_age_months));
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  if (date <= today) {
    today.setUTCDate(today.getUTCDate() + 7);
    return today.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}
