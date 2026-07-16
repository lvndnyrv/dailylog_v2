"use client";

import type { RoomLiveStatus } from "@dailylog/db/queries";
import { useActionState } from "react";
import { assignFloaterAction, type RoomActionState } from "@/lib/rooms/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Assign floater 7c — send an unassigned educator to a room.
export function AssignFloaterModal({
  floaters,
  rooms,
  initialEducatorId,
  onClose,
}: {
  floaters: { id: string; full_name: string }[];
  rooms: RoomLiveStatus[];
  initialEducatorId: string | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    assignFloaterAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Send a floater to a room</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          They pick up the room&apos;s logging and attendance the moment you assign.
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Assigned.</b> The room card updates on the next refresh.
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Educator</span>
            <select
              name="educator_id"
              defaultValue={initialEducatorId ?? ""}
              required
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
            >
              <option value="" disabled>
                Pick an educator
              </option>
              {floaters.map((floater) => (
                <option key={floater.id} value={floater.id}>
                  {floater.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Room</span>
            <select
              name="room_id"
              defaultValue=""
              required
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
            >
              <option value="" disabled>
                Pick a room
              </option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Assigning…" : "Assign"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
