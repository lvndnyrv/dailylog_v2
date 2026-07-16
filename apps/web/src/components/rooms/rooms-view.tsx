"use client";

import type { RoomLiveStatus, RoomTransition } from "@dailylog/db/queries";
import { isOverRatio } from "@dailylog/shared";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { moveChildToRoomAction } from "@/lib/rooms/actions";
import { AssignFloaterModal } from "./assign-floater-modal";
import { RatioRulesModal } from "./ratio-rules-modal";
import { RoomFormModal } from "./room-form-modal";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";

interface Floater {
  id: string;
  full_name: string;
  email: string;
}

export function RoomsView({
  rooms,
  floaters,
  transitions,
}: {
  rooms: RoomLiveStatus[];
  floaters: Floater[];
  transitions: RoomTransition[];
}) {
  const [modal, setModal] = useState<
    "none" | "add" | "rules" | { assign: string | null }
  >("none");

  return (
    <div className="flex flex-1 flex-col gap-4 p-7">
      <div className="flex items-center gap-2">
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setModal("rules")}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Edit ratio rules
        </button>
        <button
          type="button"
          onClick={() => setModal("add")}
          className="rounded-btn bg-primary px-[18px] py-2 text-[13px] font-bold text-white hover:bg-primary-hover"
        >
          + Add a room
        </button>
      </div>

      <div className="grid grid-cols-2 items-start gap-4 xl:grid-cols-[1.5fr_1fr]">
        {/* Room cards */}
        <div className="flex flex-col gap-3">
          {rooms.map((room) => {
            const educatorCount = room.educators.length;
            const present = Number(room.present_count);
            const over =
              room.ratio_children_per_educator !== null &&
              isOverRatio(present, educatorCount, room.ratio_children_per_educator);

            return (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
                className={`${card} flex items-center gap-4 hover:bg-[#F8FBFE]`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-extrabold text-ink">{room.name}</span>
                    {room.min_age_months !== null && room.max_age_months !== null && (
                      <span className="text-[11.5px] text-faint">
                        {formatBand(room.min_age_months, room.max_age_months)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    {room.enrolled_count} enrolled
                    {room.capacity ? ` · capacity ${room.capacity}` : ""} ·{" "}
                    {room.educators.map((e) => e.full_name.split(" ")[0]).join(", ") ||
                      "no educators assigned"}
                  </span>
                </span>

                <span className="text-right">
                  <span className="block text-[18px] font-extrabold text-ink">
                    {present}
                    <span className="text-[12px] font-semibold text-faint">
                      {" "}
                      in · {educatorCount} edu
                    </span>
                  </span>
                  {room.ratio_children_per_educator !== null && (
                    <span
                      className={`inline-block rounded-full px-2.5 py-[3px] text-[11px] font-bold ${
                        over
                          ? "bg-danger-bg text-danger"
                          : "bg-[#E4F3EC] text-success"
                      }`}
                    >
                      {over ? "Over ratio" : "In ratio"} · 1:
                      {room.ratio_children_per_educator}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
          {rooms.length === 0 && (
            <div className={`${card} py-10 text-center text-[12.5px] text-muted`}>
              No rooms yet — add the first one.
            </div>
          )}
        </div>

        {/* Right rail: floater pool + transitions */}
        <div className="flex flex-col gap-4">
          <section className={card} aria-labelledby="floaters-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="floaters-h" className={cardTitle}>
                Floater pool
              </h2>
              <span className="text-[11.5px] text-faint">not assigned to a room</span>
            </div>
            {floaters.length === 0 ? (
              <p className="text-[12.5px] text-faint">
                Everyone has a room. Educators without an assignment appear here.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {floaters.map((floater) => (
                  <div key={floater.id} className="flex items-center gap-2.5">
                    <Avatar name={floater.full_name} size={30} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
                      {floater.full_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setModal({ assign: floater.id })}
                      className="rounded-btn border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-xs font-bold text-primary hover:bg-canvas"
                    >
                      Send to a room
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={card} aria-labelledby="transitions-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="transitions-h" className={cardTitle}>
                Upcoming transitions
              </h2>
              <span className="text-[11.5px] text-faint">aging out within 2 months</span>
            </div>
            {transitions.length === 0 ? (
              <p className="text-[12.5px] text-faint">
                No one is close to aging out of their room.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {transitions.map((t) => (
                  <div key={t.child_id} className="flex items-center gap-2.5">
                    <Avatar name={`${t.first_name} ${t.last_name}`} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink">
                        {t.first_name} {t.last_name}
                      </span>
                      <span className="block text-[11.5px] text-muted">
                        {t.room_name} → {t.next_room_name ?? "no next room"} ·{" "}
                        {Math.floor(t.age_months / 12)}y {t.age_months % 12}m
                      </span>
                    </span>
                    {t.next_room_id && (
                      <form action={moveChildToRoomAction}>
                        <input type="hidden" name="child_id" value={t.child_id} />
                        <input type="hidden" name="room_id" value={t.next_room_id} />
                        <button
                          type="submit"
                          className="rounded-btn border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-xs font-bold text-primary hover:bg-canvas"
                        >
                          Move now
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2.5 text-[11.5px] text-faint">
              Scheduled future moves arrive with enrollment (Phase 5) — moves here
              apply immediately.
            </p>
          </section>
        </div>
      </div>

      {modal === "add" && <RoomFormModal onClose={() => setModal("none")} />}
      {modal === "rules" && (
        <RatioRulesModal rooms={rooms} onClose={() => setModal("none")} />
      )}
      {typeof modal === "object" && (
        <AssignFloaterModal
          floaters={floaters}
          rooms={rooms}
          initialEducatorId={modal.assign}
          onClose={() => setModal("none")}
        />
      )}
    </div>
  );
}

function formatBand(min: number, max: number): string {
  const label = (months: number) =>
    months < 24 ? `${months} mo` : `${Math.floor(months / 12)} y`;
  return `${label(min)}–${label(max)}`;
}
