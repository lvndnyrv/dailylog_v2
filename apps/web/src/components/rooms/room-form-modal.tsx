"use client";

import type { RoomLiveStatus } from "@dailylog/db/queries";
import { useActionState, useState } from "react";
import {
  createRoomAction,
  updateRoomAction,
  type RoomActionState,
} from "@/lib/rooms/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const AGE_BANDS = [
  { label: "Infant", min: 0, max: 18, ratio: 3 },
  { label: "Toddler", min: 18, max: 36, ratio: 5 },
  { label: "Preschool", min: 36, max: 60, ratio: 8 },
  { label: "Kindergarten", min: 60, max: 72, ratio: 10 },
] as const;

export function RoomFormModal({
  room,
  rooms,
  educators,
  onClose,
}: {
  room?: RoomLiveStatus;
  rooms: RoomLiveStatus[];
  educators: { id: string; fullName: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    room ? updateRoomAction : createRoomAction,
    {},
  );
  const initialBand = AGE_BANDS.find(
    (band) => band.min === room?.min_age_months && band.max === room?.max_age_months,
  );
  const [band, setBand] = useState<(typeof AGE_BANDS)[number]>(initialBand ?? AGE_BANDS[0]);
  const [customBand, setCustomBand] = useState(Boolean(room && !initialBand));
  const [customMin, setCustomMin] = useState(room?.min_age_months ?? 0);
  const [customMax, setCustomMax] = useState(room?.max_age_months ?? 18);
  const [ratio, setRatio] = useState(room?.ratio_children_per_educator ?? band.ratio);

  const chooseBand = (next: (typeof AGE_BANDS)[number]) => {
    setCustomBand(false);
    setBand(next);
    const centerRule = rooms.find(
      (candidate) =>
        candidate.age_group?.toLowerCase() === next.label.toLowerCase() ||
        (candidate.min_age_months === next.min && candidate.max_age_months === next.max),
    )?.ratio_children_per_educator;
    setRatio(centerRule ?? next.ratio);
  };

  const chooseCustom = () => {
    setCustomBand(true);
    setRatio(room?.ratio_children_per_educator ?? ratio);
  };

  return (
    <Modal onClose={onClose} width={470}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          {room ? `Edit ${room.name}` : "Add a room"}
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Set the licensed age band, room capacity, and educator coverage owner.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        {room && <input type="hidden" name="room_id" value={room.id} />}
        <input type="hidden" name="age_group" value={customBand ? "Custom" : band.label} />
        <input type="hidden" name="min_age_months" value={customBand ? customMin : band.min} />
        <input type="hidden" name="max_age_months" value={customBand ? customMax : band.max} />
        <input type="hidden" name="ratio" value={ratio} />

        <Field label="Room name" name="name" defaultValue={room?.name ?? ""} required />

        <fieldset>
          <legend className="mb-2 text-[13px] font-bold text-ink">Age band</legend>
          <div className="flex flex-wrap gap-2">
            {AGE_BANDS.map((option) => {
              const active = !customBand && band.label === option.label;
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => chooseBand(option)}
                  className={`min-w-[82px] flex-1 rounded-full border-[1.5px] px-2.5 py-2 text-[11.5px] font-bold ${
                    active
                      ? "border-primary bg-tint text-primary"
                      : "border-[#D6E1F0] bg-card text-muted hover:bg-canvas"
                  }`}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={chooseCustom}
              className={`min-w-[82px] flex-1 rounded-full border-[1.5px] px-2.5 py-2 text-[11.5px] font-bold ${
                customBand
                  ? "border-primary bg-tint text-primary"
                  : "border-[#D6E1F0] bg-card text-muted hover:bg-canvas"
              }`}
              aria-pressed={customBand}
            >
              Custom
            </button>
          </div>
          {customBand ? (
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <Field
                label="Youngest age (months)"
                type="number"
                min={0}
                value={customMin}
                onChange={(event) => setCustomMin(Number(event.target.value))}
                required
              />
              <Field
                label="Oldest age (months)"
                type="number"
                min={customMin + 1}
                value={customMax}
                onChange={(event) => setCustomMax(Number(event.target.value))}
                required
              />
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-faint">
              {band.min}–{band.max} months · center rule 1 : {ratio}
            </p>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Capacity"
            name="capacity"
            type="number"
            min={1}
            defaultValue={room?.capacity ?? ""}
            required
          />
          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Licensed ratio</span>
            <span className="flex h-[47px] items-center justify-between rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-2 text-[14px] font-bold text-ink">
              <button type="button" onClick={() => setRatio((value) => Math.max(1, value - 1))} className="size-8 text-faint hover:text-ink" aria-label="Make ratio stricter">−</button>
              1 : {ratio}
              <button type="button" onClick={() => setRatio((value) => value + 1)} className="size-8 text-faint hover:text-ink" aria-label="Allow one more child">+</button>
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Opens on"
            name="opens_on"
            type="date"
            defaultValue={room?.opens_on ?? ""}
          />
          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Lead educator</span>
            <select
              name="lead_educator_id"
              defaultValue={room?.lead_educator_id ?? ""}
              className="h-[47px] rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3.5 text-[13px] text-ink outline-none focus:border-primary"
            >
              <option value="">Assign later</option>
              {educators.map((educator) => (
                <option key={educator.id} value={educator.id}>{educator.fullName}</option>
              ))}
            </select>
          </label>
        </div>

        {room && (
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Nap starts" name="nap_start" type="time" defaultValue={room.nap_start?.slice(0, 5) ?? ""} />
            <Field label="Nap ends" name="nap_end" type="time" defaultValue={room.nap_end?.slice(0, 5) ?? ""} />
          </div>
        )}

        <div className="rounded-[13px] bg-tint px-3.5 py-3 text-[11.5px] leading-relaxed text-ink">
          {customBand
            ? "Custom age bands use the ratio you set above. Confirm it against the center's licensing policy before opening the room."
            : "The ratio is inherited from this center's matching age-band rule. You can make it stricter here or edit the center rules table."}
        </div>

        {state.ok && <Notice tone="success"><b>Room saved.</b></Notice>}
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
