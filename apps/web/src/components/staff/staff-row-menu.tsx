"use client";

import { Copy, Mail, Pencil, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { deactivateStaffAction } from "@/lib/staff/actions";
import { Modal } from "@/components/ui/modal";
import { RowActionMenu } from "@/components/ui/row-action-menu";

export function StaffRowMenu({
  staffId,
  profileId,
  currentProfileId,
  name,
  email,
  onDuplicate,
}: {
  staffId: string;
  profileId: string;
  currentProfileId: string;
  name: string;
  email: string;
  onDuplicate: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isSelf = profileId === currentProfileId;

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <RowActionMenu
        label={`Actions for ${name}`}
        actions={[
          { label: "View profile", icon: UserRound, href: `/staff/${staffId}` },
          { label: "Edit details", icon: Pencil, href: `/staff/${staffId}?edit=1` },
          { label: "Message", icon: Mail, href: `mailto:${email}` },
          { label: "Duplicate", icon: Copy, onSelect: onDuplicate },
          ...(!isSelf
            ? [
                {
                  label: "Remove from center",
                  icon: Trash2,
                  tone: "danger" as const,
                  onSelect: () => setConfirming(true),
                },
              ]
            : []),
        ]}
      />

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <div>
            <h2 className="text-[19px] font-extrabold text-ink">Remove {name} from the center?</h2>
            <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
              Their access ends and they leave the roster. Time, certification and audit
              history remain available.
            </p>
          </div>
          <form action={deactivateStaffAction} className="flex gap-2.5">
            <input type="hidden" name="staff_id" value={staffId} />
            <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas">
              Keep active
            </button>
            <button type="submit" className="flex-1 rounded-btn bg-danger px-4 py-3 text-sm font-bold text-white hover:brightness-95">
              Remove
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
