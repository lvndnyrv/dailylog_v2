"use client";

import type { RoomLiveStatus, StaffShiftRow } from "@dailylog/db/queries";
import { useActionState, useState } from "react";
import { assignFloaterAction, type RoomActionState } from "@/lib/rooms/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Assign floater 7c — send an unassigned educator to a room.
export function AssignFloaterModal({
  floaters,
  rooms,
  shifts,
  initialEducatorId,
  initialRoomId,
  date,
  timeZone,
  onClose,
}: {
  floaters: { id: string; full_name: string }[];
  rooms: RoomLiveStatus[];
  shifts: StaffShiftRow[];
  initialEducatorId: string | null;
  initialRoomId?: string | null;
  date: string;
  timeZone: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    assignFloaterAction,
    {},
  );
  const [educatorId, setEducatorId] = useState(initialEducatorId ?? "");
  const [roomId, setRoomId] = useState(initialRoomId ?? "");
  const [startsAt, setStartsAt] = useState("12:00");
  const [endsAt, setEndsAt] = useState("14:00");
  const educator = floaters.find((item) => item.id === educatorId);
  const room = rooms.find((item) => item.id === roomId);

  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Assign room coverage</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Cover a specific gap without changing the educator&apos;s primary room.
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Coverage assigned.</b> It now appears on today&apos;s timeline.
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="time_zone" value={timeZone} />
          <fieldset>
            <legend className="mb-2 text-[13px] font-bold text-ink">Suggested floaters</legend>
            <div className="flex flex-col gap-2">
              {floaters.map((floater) => {
                const shift = shifts.find(
                  (item) => item.staff?.profile?.id === floater.id && dateInZone(item.starts_at, timeZone) === date,
                );
                const active = educatorId === floater.id;
                return (
                  <label key={floater.id} className={`flex cursor-pointer items-center gap-3 rounded-[13px] border-[1.5px] px-3 py-2.5 ${active ? "border-primary bg-tint" : "border-[#D6E1F0] bg-card hover:bg-canvas"}`}>
                    <input type="radio" name="educator_id" value={floater.id} checked={active} onChange={() => setEducatorId(floater.id)} required className="sr-only" />
                    <Avatar name={floater.full_name} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold text-ink">{floater.full_name}</span>
                      <span className="block text-[10.5px] text-muted">
                        {shift ? `Available on shift · ${shortTime(shift.starts_at, timeZone)}–${shortTime(shift.ends_at, timeZone)}` : "Unassigned · no published shift today"}
                      </span>
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${shift ? "bg-[#E4F3EC] text-success" : "bg-[#FFF3DD] text-[#A86D13]"}`}>
                      {shift ? "Available" : "Check availability"}
                    </span>
                  </label>
                );
              })}
              {floaters.length === 0 && (
                <p className="rounded-[13px] bg-canvas px-3 py-3 text-[11.5px] text-faint">No active floaters are available to assign.</p>
              )}
            </div>
          </fieldset>

          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Room</span>
            <select
              name="room_id"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
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

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-[7px]">
              <span className="text-[13px] font-bold text-ink">Starts</span>
              <input
                name="starts_at"
                type="time"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                required
                className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-[7px]">
              <span className="text-[13px] font-bold text-ink">Ends</span>
              <input
                name="ends_at"
                type="time"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required
                className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Coverage note <i className="font-normal text-faint">optional</i></span>
            <input
              name="notes"
              placeholder="Lunch break, sick coverage…"
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none placeholder:text-faint focus:border-primary"
            />
          </label>

          <div className="rounded-[13px] border border-[#D6E1F0] bg-tint px-3.5 py-3 text-[11.5px] leading-relaxed text-ink">
            {educator && room ? (
              <><b>{educator.full_name}</b> will cover <b>{room.name}</b> from <b>{startsAt}</b> to <b>{endsAt}</b>. This fills only that segment; their primary-room assignment remains unchanged.</>
            ) : (
              "Choose a floater and target room to review the coverage segment."
            )}
          </div>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Assigning…" : "Assign coverage"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
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

function shortTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value)).replace(" ", "");
}
