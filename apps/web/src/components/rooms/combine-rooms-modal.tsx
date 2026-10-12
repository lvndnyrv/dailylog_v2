"use client";

import type { RoomLiveStatus } from "@dailylog/db/queries";
import type { Tables } from "@dailylog/db";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { updateRoomCombinationsAction, type RoomActionState } from "@/lib/rooms/actions";

export function CombineRoomsModal({
  rooms,
  combinations,
  onClose,
}: {
  rooms: RoomLiveStatus[];
  combinations: Tables<"room_combinations">[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    updateRoomCombinationsAction,
    {},
  );
  const morning = combinations.find((item) => item.period === "morning");
  const evening = combinations.find((item) => item.period === "evening");
  const [morningState, setMorningState] = useState(() => combinationState(morning, "07:00", "08:00"));
  const [eveningState, setEveningState] = useState(() => combinationState(evening, "17:00", "18:00"));

  return (
    <Modal onClose={onClose} width={470}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Combine rooms at open & close</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Plan low-attendance periods without changing each child&apos;s home room.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <Notice tone="info">Saving activates enabled weekday schedules. During each window the host uses the stricter ratio and shared roster; educator access expires when the window ends. Existing plans stay inactive until saved.</Notice>
        <CombinationFields
          period="morning"
          label="Morning"
          rooms={rooms}
          value={morningState}
          onChange={setMorningState}
        />
        <CombinationFields
          period="evening"
          label="Evening"
          rooms={rooms}
          value={eveningState}
          onChange={setEveningState}
        />

        <div className="rounded-[13px] border border-[#D6E1F0] bg-tint px-3.5 py-3 text-[12px] leading-relaxed text-ink">
          <b className="block text-[12.5px]">The mixed-age rule</b>
          <p className="mt-1 text-muted">
            The stricter configured ratio applies to the entire group, with the host room&apos;s capacity. Pause a schedule for today from Rooms or the dashboard without deleting it.
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            <RatioCalculation label="Morning" value={morningState} rooms={rooms} />
            <RatioCalculation label="Evening" value={eveningState} rooms={rooms} />
          </div>
        </div>

        {state.ok && <Notice tone="success"><b>Combination rules saved.</b></Notice>}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Saving…" : "Save combinations"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CombinationFields({
  period,
  label,
  rooms,
  value,
  onChange,
}: {
  period: "morning" | "evening";
  label: string;
  rooms: RoomLiveStatus[];
  value: CombinationState;
  onChange: (value: CombinationState) => void;
}) {
  return (
    <fieldset className="rounded-[14px] border-[1.5px] border-[#D6E1F0] p-3.5">
      <legend className="px-1 text-[13px] font-extrabold text-ink">{label}</legend>
      <label className="mb-3 flex items-center gap-3">
        <span className="flex-1 text-[12px] text-muted">Combine these rooms every weekday</span>
        <input
          type="checkbox"
          name={`${period}_enabled`}
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          className="size-4 accent-primary"
        />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <SelectRoom
          label="Move children from"
          name={`${period}_source`}
          rooms={rooms}
          value={value.source}
          onChange={(source) => onChange({ ...value, source })}
        />
        <SelectRoom
          label="Into"
          name={`${period}_host`}
          rooms={rooms}
          value={value.host}
          onChange={(host) => onChange({ ...value, host })}
        />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <TimeField label="Starts" name={`${period}_starts`} value={value.starts} onChange={(starts) => onChange({ ...value, starts })} />
        <TimeField label="Ends" name={`${period}_ends`} value={value.ends} onChange={(ends) => onChange({ ...value, ends })} />
      </div>
      {value.enabled && value.source && value.source === value.host && (
        <p className="mt-2 text-[11px] font-semibold text-danger">Choose two different rooms.</p>
      )}
    </fieldset>
  );
}

function SelectRoom({
  label,
  name,
  rooms,
  value,
  onChange,
}: {
  label: string;
  name: string;
  rooms: RoomLiveStatus[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-bold text-ink">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 rounded-[11px] border-[1.5px] border-[#D6E1F0] bg-card px-3 py-2.5 text-[12px] text-ink outline-none focus:border-primary"
      >
        <option value="">Choose room</option>
        {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
      </select>
    </label>
  );
}

function TimeField({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-bold text-ink">{label}</span>
      <input
        type="time"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[11px] border-[1.5px] border-[#D6E1F0] bg-card px-3 py-2.5 text-[12px] text-ink outline-none focus:border-primary"
      />
    </label>
  );
}

function trimTime(value: string | undefined): string {
  return value?.slice(0, 5) ?? "";
}

interface CombinationState {
  enabled: boolean;
  source: string;
  host: string;
  starts: string;
  ends: string;
}

function combinationState(
  value: Tables<"room_combinations"> | undefined,
  starts: string,
  ends: string,
): CombinationState {
  return {
    enabled: value?.enabled ?? false,
    source: value?.source_classroom_id ?? "",
    host: value?.host_classroom_id ?? "",
    starts: trimTime(value?.starts_at) || starts,
    ends: trimTime(value?.ends_at) || ends,
  };
}

function RatioCalculation({
  label,
  value,
  rooms,
}: {
  label: string;
  value: CombinationState;
  rooms: RoomLiveStatus[];
}) {
  if (!value.enabled) {
    return <span className="text-[11.5px] text-faint">{label}: not enabled</span>;
  }
  const source = rooms.find((room) => room.id === value.source);
  const host = rooms.find((room) => room.id === value.host);
  if (!source || !host || source.id === host.id) {
    return <span className="text-[11.5px] text-[#A86D13]">{label}: choose two different rooms to calculate the ratio</span>;
  }
  const ratios = [source.ratio_children_per_educator, host.ratio_children_per_educator]
    .filter((ratio): ratio is number => ratio !== null);
  const strictest = ratios.length > 0 ? Math.min(...ratios) : null;
  return (
    <span className="flex items-center justify-between gap-3 rounded-[9px] bg-card px-2.5 py-2 text-[11.5px]">
      <span><b>{label}:</b> {source.name} 1:{source.ratio_children_per_educator ?? "—"} + {host.name} 1:{host.ratio_children_per_educator ?? "—"}</span>
      <b className="whitespace-nowrap text-primary">use 1:{strictest ?? "—"}</b>
    </span>
  );
}
