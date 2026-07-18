"use client";

import type { RoomLiveStatus } from "@dailylog/db/queries";
import { useActionState, useState } from "react";
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
  const [ratios, setRatios] = useState<Record<string, number>>(() =>
    Object.fromEntries(rooms.map((room) => [room.id, room.ratio_children_per_educator ?? 1])),
  );

  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Ratio rules</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Center policy table — choose the licensed children-per-educator limit for each room.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="flex items-center gap-3 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
            >
              <input type="hidden" name="room_id" value={room.id} />
              <input type="hidden" name="ratio" value={ratios[room.id]} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-ink">{room.name}</span>
                {room.min_age_months !== null && room.max_age_months !== null && (
                  <span className="block text-[11.5px] text-faint">
                    {room.min_age_months}–{room.max_age_months} months
                  </span>
                )}
              </span>
              <span className="flex items-center rounded-full border-[1.5px] border-[#D6E1F0] text-[13px] font-bold text-ink">
                <button
                  type="button"
                  onClick={() => setRatios((current) => ({ ...current, [room.id]: Math.max(1, current[room.id] - 1) }))}
                  className="px-3 py-1.5 text-faint hover:text-ink"
                  aria-label={`Make ${room.name} ratio stricter`}
                >
                  −
                </button>
                <span className="min-w-12 text-center">1 : {ratios[room.id]}</span>
                <button
                  type="button"
                  onClick={() => setRatios((current) => ({ ...current, [room.id]: current[room.id] + 1 }))}
                  className="px-3 py-1.5 text-faint hover:text-ink"
                  aria-label={`Allow one more child per educator in ${room.name}`}
                >
                  +
                </button>
              </span>
            </div>
          ))}
        </div>

        <p className="text-center text-[11.5px] leading-normal text-faint">
          Changes recompute today&apos;s live ratios immediately. Keep each value within your center&apos;s licensed policy.
        </p>

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
