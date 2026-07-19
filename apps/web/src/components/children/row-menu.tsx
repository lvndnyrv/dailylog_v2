"use client";

import { Copy, Mail, Pencil, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { archiveChildAction, duplicateChildAction } from "@/lib/children/actions";
import { Modal } from "@/components/ui/modal";
import { RowActionMenu } from "@/components/ui/row-action-menu";

// Row action menu 18a: view, edit, message, duplicate — destructive set apart.
export function RowMenu({
  childId,
  childName,
  presentation = "row",
}: {
  childId: string;
  childName: string;
  presentation?: "row" | "profile";
}) {
  const [confirming, setConfirming] = useState<"none" | "duplicate" | "remove">("none");

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <RowActionMenu
        label={`Actions for ${childName}`}
        presentation={presentation}
        actions={[
          { label: "View profile", icon: UserRound, href: `/children/${childId}` },
          { label: "Edit details", icon: Pencil, href: `/children/${childId}?edit=1` },
          { label: "Message parents", icon: Mail, href: `/messages?child=${childId}` },
          { label: "Duplicate", icon: Copy, onSelect: () => setConfirming("duplicate") },
          {
            label: "Remove from center",
            icon: Trash2,
            tone: "danger",
            onSelect: () => setConfirming("remove"),
          },
        ]}
      />

      {confirming === "duplicate" && (
        <Modal onClose={() => setConfirming("none")}>
          <div>
            <h2 className="text-[19px] font-extrabold text-ink">Duplicate {childName}?</h2>
            <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
              A new draft copies the room, birthday and recurring schedule. Medical,
              family and consent records stay private to the original child.
            </p>
          </div>
          <form action={duplicateChildAction} className="flex gap-2.5">
            <input type="hidden" name="child_id" value={childId} />
            <button type="button" onClick={() => setConfirming("none")} className="flex-1 rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas">
              Cancel
            </button>
            <button type="submit" className="flex-1 rounded-btn bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary-hover">
              Create draft
            </button>
          </form>
        </Modal>
      )}

      {confirming === "remove" && (
        <Modal onClose={() => setConfirming("none")}>
          <div>
            <h2 className="text-[19px] font-extrabold text-ink">
              Remove {childName} from the center?
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
              The record is archived, not deleted — logs and history stay for
              compliance, and the child leaves the roster.
            </p>
          </div>
          <form action={archiveChildAction} className="flex gap-2.5">
            <input type="hidden" name="child_id" value={childId} />
            <button
              type="button"
              onClick={() => setConfirming("none")}
              className="flex-1 rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas"
            >
              Keep enrolled
            </button>
            <button
              type="submit"
              className="flex-1 rounded-btn bg-danger px-4 py-3 text-sm font-bold text-white hover:brightness-95"
            >
              Remove
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
