"use client";

import type { RoomLiveStatus } from "@dailylog/db/queries";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function OverRatioModal({
  room,
  afterMinutes,
  onAssign,
  onCombine,
  onClose,
}: {
  room: RoomLiveStatus;
  afterMinutes: number;
  onAssign: () => void;
  onCombine: () => void;
  onClose: () => void;
}) {
  const present = Number(room.present_count);
  const educators = room.educators.length;
  const ratio = room.ratio_children_per_educator ?? 1;
  const required = Math.max(1, Math.ceil(present / ratio));

  return (
    <Modal onClose={onClose} width={410}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">{room.name} is over ratio</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          {educators} educator{educators === 1 ? "" : "s"} with {present} children right now.
          The room needs {required} under its 1 : {ratio} rule.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-[13px] border-[1.5px] border-[#EFC3C3] bg-danger-bg px-3.5 py-3">
        <AlertTriangle size={16} className="text-danger" aria-hidden />
        <span className="text-[12px] leading-relaxed text-ink">
          The configured alert threshold is <b>{afterMinutes} minute{afterMinutes === 1 ? "" : "s"}</b>.
          Live counts update with attendance and staff assignments.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAssign}
          className="rounded-[13px] border-[1.5px] border-primary bg-tint px-3.5 py-3 text-left"
        >
          <span className="block text-[13px] font-bold text-ink">Assign time-bound coverage</span>
          <span className="block text-[11.5px] text-muted">Send an available staff member for the gap.</span>
        </button>
        <button
          type="button"
          onClick={onCombine}
          className="rounded-[13px] border-[1.5px] border-[#D6E1F0] px-3.5 py-3 text-left hover:bg-canvas"
        >
          <span className="block text-[13px] font-bold text-ink">Use an open/close combination</span>
          <span className="block text-[11.5px] text-muted">Only when the mixed-age rule permits it.</span>
        </button>
      </div>

      <Button type="button" variant="secondary" className="py-3 text-sm" onClick={onClose}>
        Close
      </Button>
    </Modal>
  );
}
