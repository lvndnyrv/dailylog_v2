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
import { validateRoomSettings } from "@/lib/rooms/room-validation";

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
  const [originalVersion] = useState(room?.updated_at ?? "");
  const initialBand = AGE_BANDS.find(
    (band) => band.min === room?.min_age_months && band.max === room?.max_age_months,
  );
  const [band, setBand] = useState<(typeof AGE_BANDS)[number]>(initialBand ?? AGE_BANDS[0]);
  const [customBand, setCustomBand] = useState(Boolean(room && !initialBand));
  const [customLabel, setCustomLabel] = useState(room?.age_group ?? "Custom");
  const [customMin, setCustomMin] = useState(String(room?.min_age_months ?? 0));
  const [customMax, setCustomMax] = useState(String(room?.max_age_months ?? 18));
  const matchingRule = (next: (typeof AGE_BANDS)[number]) => rooms.find(
    (candidate) => candidate.age_group?.toLowerCase() === next.label.toLowerCase() ||
      (candidate.min_age_months === next.min && candidate.max_age_months === next.max),
  )?.ratio_children_per_educator;
  const [ratio, setRatio] = useState(room?.ratio_children_per_educator ?? matchingRule(band) ?? band.ratio);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fieldErrors = { ...state.fieldErrors, ...errors };
  const fieldProps = (key: string) => ({
    "aria-invalid": Boolean(fieldErrors[key]),
    "aria-describedby": fieldErrors[key] ? `room-error-${key}` : undefined,
    className: fieldErrors[key] ? "!border-danger" : "",
  });
  const close = () => { if (!pending) onClose(); };

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
    setCustomLabel("Custom");
    setRatio(room?.ratio_children_per_educator ?? ratio);
  };

  return (
    <Modal onClose={close} width={470}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          {room ? `Edit ${room.name}` : "Add a room"}
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Set the age band, room capacity, and lead educator. Required fields are labelled below.
        </p>
      </div>

      <form action={action} noValidate className="flex flex-col gap-4" onSubmit={(event) => {
        const values = Object.fromEntries(Array.from(new FormData(event.currentTarget).entries(), ([key, value]) => [key, String(value)]));
        const next = validateRoomSettings(values);
        setErrors(next);
        if (Object.keys(next).length) {
          event.preventDefault();
          const first = event.currentTarget.elements.namedItem(Object.keys(next)[0]);
          if (first instanceof HTMLElement) first.focus();
        }
      }}>
        {room && <input type="hidden" name="room_id" value={room.id} />}
        {room && <input type="hidden" name="updated_at" value={originalVersion} />}
        {!customBand && <input type="hidden" name="age_group" value={band.label} />}
        {!customBand && <input type="hidden" name="min_age_months" value={band.min} />}
        {!customBand && <input type="hidden" name="max_age_months" value={band.max} />}
        <input type="hidden" name="ratio" value={ratio} />

        <fieldset disabled={pending || state.ok} className="flex min-w-0 flex-col gap-4">
        <Field label="Room name (required)" name="name" maxLength={100} defaultValue={room?.name ?? ""} required {...fieldProps("name")} />

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
            <div className="mt-2.5">
              <Field label="Age-band name (required)" name="age_group" maxLength={100} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} required {...fieldProps("age_group")} />
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <Field
                label="Youngest age · months (required)"
                name="min_age_months"
                type="number"
                min={0}
                max={215}
                value={customMin}
                onChange={(event) => setCustomMin(event.target.value)}
                required
                {...fieldProps("min_age_months")}
              />
              <Field
                label="Oldest age · months (required)"
                name="max_age_months"
                type="number"
                min={Number(customMin) + 1}
                max={216}
                value={customMax}
                onChange={(event) => setCustomMax(event.target.value)}
                required
                {...fieldProps("max_age_months")}
              />
            </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-faint">
              {band.min}–{band.max} months · {matchingRule(band) ? "Based on a matching center room" : "Suggested starting ratio — verify before use"}
            </p>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Capacity (required)"
            name="capacity"
            type="number"
            min={1}
            max={9999}
            defaultValue={room?.capacity ?? ""}
            required
            {...fieldProps("capacity")}
          />
          <Field
            label="Opens on (optional)"
            name="opens_on"
            type="date"
            defaultValue={room?.opens_on ?? ""}
          />
        </div>
          <label className="flex min-w-0 flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Children per educator</span>
            <span className="flex h-[47px] items-center justify-between rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-2 text-[14px] font-bold text-ink">
              <button type="button" onClick={() => setRatio((value) => Math.max(1, value - 1))} className="size-8 text-faint hover:text-ink" aria-label="Make ratio stricter">−</button>
              1 : {ratio}
              <button type="button" onClick={() => setRatio((value) => Math.min(999, value + 1))} className="size-8 text-faint hover:text-ink" aria-label="Allow one more child">+</button>
            </span>
          </label>

        <div className="grid gap-2.5">
          <label className="flex min-w-0 flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Lead educator</span>
            <select
              name="lead_educator_id"
              defaultValue={room?.lead_educator_id ?? ""}
              className="h-[47px] min-w-0 w-full rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3.5 text-[13px] text-ink outline-none focus:border-primary"
            >
              <option value="">Assign later</option>
              {room?.lead_educator_id && !educators.some((person) => person.id === room.lead_educator_id) && <option value={room.lead_educator_id} disabled>Previous lead unavailable — choose a replacement or assign later</option>}
              {educators.map((educator) => (
                <option key={educator.id} value={educator.id}>{educator.fullName}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[11.5px] leading-relaxed text-muted">The lead is responsible for this room. This does not change their home room, access, shifts or live ratio count. Use coverage planning to arrange staffing, including for future openings.</p>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Nap starts (optional)" name="nap_start" type="time" defaultValue={room?.nap_start?.slice(0, 5) ?? ""} {...fieldProps("nap_start")} />
            <Field label="Nap ends (optional)" name="nap_end" type="time" defaultValue={room?.nap_end?.slice(0, 5) ?? ""} {...fieldProps("nap_end")} />
          </div>

        <div className="rounded-[13px] bg-tint px-3.5 py-3 text-[11.5px] leading-relaxed text-ink">
          Ratios here are center-configured, not verified licensing limits. Confirm the age band, capacity and ratio against your center’s licensing requirements before opening. Other rooms’ rules are not changed.
        </div>
        </fieldset>

        {Object.entries(fieldErrors).length > 0 && <div role="alert" className="text-[12px] text-danger">
          {Object.entries(fieldErrors).map(([key, message]) => <p key={key} id={`room-error-${key}`}>{message}</p>)}
        </div>}

        {state.ok && <Notice tone="success"><b>Room saved.</b></Notice>}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={close} disabled={pending}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending || state.ok}>
            {pending ? "Saving…" : room ? "Save room" : "Add room"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
