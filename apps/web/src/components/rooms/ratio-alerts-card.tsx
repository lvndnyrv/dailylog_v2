"use client";

import { useState, useTransition } from "react";
import { updateRatioAlertsAction } from "@/lib/rooms/actions";

export function RatioAlertsCard({
  initial,
}: {
  initial: { afterMinutes: number; notifyFloaters: boolean; blockCheckins: boolean };
}) {
  const [settings, setSettings] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  const save = (next: typeof settings) => {
    setSettings(next);
    setStatus("idle");
    startTransition(async () => {
      const result = await updateRatioAlertsAction(next);
      setStatus(result.error ? "error" : "saved");
    });
  };

  return (
    <section className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card px-4 py-4">
      <div className="mb-3 flex items-center">
        <h2 className="text-[14px] font-extrabold text-ink">Ratio alerts</h2>
        <span className="ml-auto text-[10.5px] text-faint">
          {pending ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Could not save" : ""}
        </span>
      </div>

      <label className="mb-3 flex items-center gap-3 text-[12.5px] text-ink">
        <span className="flex-1">Alert me after</span>
        <select
          value={settings.afterMinutes}
          onChange={(event) => save({ ...settings, afterMinutes: Number(event.target.value) })}
          disabled={pending}
          className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-3 py-1.5 text-[12px] font-bold text-ink outline-none focus:border-primary"
          aria-label="Ratio alert delay"
        >
          {[0, 5, 10, 15, 30].map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0 ? "Immediately" : `${minutes} min over`}
            </option>
          ))}
        </select>
      </label>
      <ToggleRow
        label="Notify free floaters too"
        checked={settings.notifyFloaters}
        disabled={pending}
        onChange={(checked) => save({ ...settings, notifyFloaters: checked })}
      />
      <ToggleRow
        label="Block check-ins when over"
        checked={settings.blockCheckins}
        disabled={pending}
        onChange={(checked) => save({ ...settings, blockCheckins: checked })}
      />
    </section>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 border-t border-[#EDF3FB] py-2.5 text-[12.5px] text-ink first:border-0">
      <span className="flex-1">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-[22px] w-[38px] rounded-full bg-[#D6E1F0] transition-colors peer-checked:bg-primary peer-disabled:opacity-60 after:absolute after:left-0.5 after:top-0.5 after:size-[18px] after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
    </label>
  );
}
