"use client";

import type { RoomLiveStatus } from "@dailylog/db/queries";
import { useActionState } from "react";
import { updateRatioRulesAction, type RoomActionState } from "@/lib/rooms/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Ratio rules 7d — one children-per-educator number per room, saved together.
export function RatioRulesModal({
  rooms,
  onClose,
}: {
  rooms: RoomLiveStatus[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    updateRatioRulesAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Ratio rules</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Counted live from check-ins. Rules follow your state&apos;s licensing table.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col">
          {rooms.map((room) => (
            <label
              key={room.id}
              className="flex items-center gap-3 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
            >
              <input type="hidden" name="room_id" value={room.id} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-ink">{room.name}</span>
                {room.min_age_months !== null && room.max_age_months !== null && (
                  <span className="block text-[11.5px] text-faint">
                    {room.min_age_months}–{room.max_age_months} months
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                1 :
                <input
                  name="ratio"
                  type="number"
                  min={1}
                  defaultValue={room.ratio_children_per_educator ?? ""}
                  className="w-16 rounded-[10px] border-[1.5px] border-[#D6E1F0] bg-card px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
                  aria-label={`Children per educator in ${room.name}`}
                />
              </span>
            </label>
          ))}
        </div>

        {state.ok && (
          <Notice tone="success">
            <b>Rules saved.</b>
          </Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Saving…" : "Save rules"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
