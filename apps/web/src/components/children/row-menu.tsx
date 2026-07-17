"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { archiveChildAction } from "@/lib/children/actions";
import { Modal } from "@/components/ui/modal";

// Row action menu 18a: view, edit, message, duplicate — destructive set apart.
export function RowMenu({ childId, childName }: { childId: string; childName: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-ink hover:bg-canvas";

  return (
    <div
      ref={ref}
      className="relative"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Actions for ${childName}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-[26px] place-items-center rounded-md text-[#C3D2E6] hover:bg-canvas hover:text-muted"
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-40 flex w-48 flex-col gap-0.5 rounded-[14px] border-[1.5px] border-hairline bg-card p-2"
          style={{ boxShadow: "0 14px 40px rgba(23,51,91,.22)" }}
        >
          <button type="button" role="menuitem" className={item} onClick={() => router.push(`/children/${childId}`)}>
            View profile
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => router.push(`/children/${childId}?edit=1`)}
          >
            Edit details
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => router.push(`/messages?child=${childId}`)}
          >
            Message parents
          </button>
          <span className={`${item} cursor-default text-muted`}>
            Duplicate <span className="ml-auto text-[10px] font-bold text-faint">Later</span>
          </span>
          <span className="mx-1 my-0.5 h-px bg-[#EDF3FB]" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-bold text-danger hover:bg-danger-bg"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
          >
            Remove from center
          </button>
        </div>
      )}

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
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
              onClick={() => setConfirming(false)}
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
