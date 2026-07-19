"use client";

import type { SetupItem } from "@dailylog/shared";
import { Modal } from "@/components/ui/modal";
import { Avatar } from "@/components/ui/avatar";

// Setup completeness panel 19b — the same five-item model as the educator app
// (mobile 13b), same copy, so "40% complete" means the same thing everywhere.
export function SetupPanel({
  childName,
  roomName,
  enrolledOn,
  setup,
  onFix,
  onClose,
}: {
  childName: string;
  roomName: string | null;
  enrolledOn: string | null;
  setup: { items: SetupItem[]; percent: number; incomplete: number };
  onFix: (key: SetupItem["key"]) => void;
  onClose: () => void;
}) {
  const firstName = childName.split(" ")[0] ?? childName;
  const added = enrolledOn
    ? new Date(enrolledOn).toLocaleDateString("en-CA", { month: "short", year: "numeric" })
    : null;
  const next = setup.items.find((item) => !item.done);
  return (
    <Modal onClose={onClose} width={560}>
      <div className="flex items-center gap-3">
        <Avatar name={childName} size={38} />
        <span className="min-w-0 flex-1">
          <h2 className="text-[19px] font-extrabold text-ink">
            Finish {firstName}&apos;s profile
          </h2>
          {(roomName || added) && (
            <span className="text-[12.5px] text-muted">
              {[roomName, added ? `added ${added}` : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        <span className="text-[17px] font-extrabold text-warning-text">{setup.percent}%</span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-[#F0E2C4]" aria-hidden>
        <div className="h-full rounded-full bg-warning" style={{ width: `${setup.percent}%` }} />
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
                className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-white hover:bg-primary-hover"
              >
                {item.key === "parents" ? "Invite" : "Add"}
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3 border-t border-[#EDF3FB] pt-4">
        <p className="min-w-0 flex-1 text-[11.5px] leading-normal text-faint">
          Incomplete profiles stay flagged on the classroom roster and the profile.
        </p>
        {next && (
          <button
            type="button"
            onClick={() => onFix(next.key)}
            className="rounded-btn bg-primary px-5 py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
          >
            Continue setup — {setup.incomplete} left
          </button>
        )}
      </div>
    </Modal>
  );
}
