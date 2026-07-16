"use client";

import type { RoomLiveStatus } from "@dailylog/db/queries";
import { useActionState } from "react";
import {
  createRoomAction,
  updateRoomAction,
  type RoomActionState,
} from "@/lib/rooms/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Add room / edit room (7d). Age band in months; ratio = children per educator.
export function RoomFormModal({
  room,
  onClose,
}: {
  room?: RoomLiveStatus;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    room ? updateRoomAction : createRoomAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          {room ? `Edit ${room.name}` : "Add a room"}
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          The ratio is your state licensing minimum — alerts key off it.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        {room && <input type="hidden" name="room_id" value={room.id} />}

        <Field label="Room name" name="name" defaultValue={room?.name ?? ""} required />
        <Field
          label="Age group label"
          name="age_group"
          defaultValue={room?.age_group ?? ""}
          placeholder="Toddler"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Min age (months)"
            name="min_age_months"
            type="number"
            min={0}
            defaultValue={room?.min_age_months ?? ""}
          />
          <Field
            label="Max age (months)"
            name="max_age_months"
            type="number"
            min={0}
            defaultValue={room?.max_age_months ?? ""}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Capacity"
            name="capacity"
            type="number"
            min={1}
            defaultValue={room?.capacity ?? ""}
          />
          <Field
            label="Children per educator"
            name="ratio"
            type="number"
            min={1}
            defaultValue={room?.ratio_children_per_educator ?? ""}
          />
        </div>

        {state.ok && (
          <Notice tone="success">
            <b>Saved.</b>
          </Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Saving…" : room ? "Save room" : "Add room"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
