"use client";

import type { SetupItem } from "@dailylog/shared";
import { Modal } from "@/components/ui/modal";

// Setup completeness panel 19b — the same five-item model as the educator app
// (mobile 13b), same copy, so "40% complete" means the same thing everywhere.
export function SetupPanel({
  childName,
  roomName,
  setup,
  onFix,
  onClose,
}: {
  childName: string;
  roomName: string | null;
  setup: { items: SetupItem[]; percent: number; incomplete: number };
  onFix: (key: SetupItem["key"]) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width={560}>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <h2 className="text-[19px] font-extrabold text-ink">
            Finish {childName}&apos;s profile
          </h2>
          {roomName && <span className="text-[12.5px] text-muted">{roomName}</span>}
        </span>
        <span className="text-[22px] font-extrabold text-primary">{setup.percent}%</span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${setup.percent}%` }} />
      </div>

      <ul className="flex flex-col">
        {setup.items.map((item) => (
          <li
            key={item.key}
            className="flex items-center gap-3 border-b border-[#EDF3FB] py-3 last:border-b-0"
          >
            {item.done ? (
              <span className="grid size-6 flex-none place-items-center rounded-full bg-[#E4F3EC] text-[12px] text-success">
                ✓
              </span>
            ) : (
              <span className="grid size-6 flex-none place-items-center rounded-full bg-warning-bg text-[12px] font-bold text-warning-text">
                !
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-ink">{item.label}</span>
              <span className="block text-[11.5px] text-muted">{item.hint}</span>
            </span>
            {item.done ? (
              <span className="text-[11.5px] font-bold text-success">Done</span>
            ) : (
              <button
                type="button"
                onClick={() => onFix(item.key)}
                className="rounded-btn border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-xs font-bold text-primary hover:bg-canvas"
              >
                {item.key === "parents" ? "Invite" : "Add"}
              </button>
            )}
          </li>
        ))}
      </ul>

      <p className="text-[11.5px] leading-normal text-faint">
        Incomplete profiles stay flagged on the classroom roster and the profile.
      </p>
    </Modal>
  );
}
