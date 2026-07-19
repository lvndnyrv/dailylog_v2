"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type RowAction = {
  label: string;
  icon: LucideIcon;
  href?: string;
  onSelect?: () => void;
  tone?: "default" | "danger";
};

export function RowActionMenu({
  label,
  actions,
  presentation = "row",
}: {
  label: string;
  actions: RowAction[];
  presentation?: "row" | "profile";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (action: RowAction) => {
    setOpen(false);
    action.onSelect?.();
  };

  return (
    <div
      ref={ref}
      className="relative"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className={
          presentation === "profile"
            ? "grid size-10 place-items-center rounded-btn border-[1.5px] border-[#D6E1F0] bg-card text-ink hover:bg-canvas"
            : `grid size-[26px] place-items-center rounded-[7px] text-[13px] ${
                open ? "bg-primary text-white" : "text-[#C3D2E6] hover:bg-canvas hover:text-muted"
              }`
        }
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 flex w-[214px] flex-col gap-px rounded-xl border-[1.5px] border-hairline bg-card p-1.5"
          style={{ boxShadow: "0 14px 40px rgba(23,51,91,.22)" }}
        >
          <span
            aria-hidden
            className="absolute -top-[7px] right-4 size-3 rotate-45 border-l-[1.5px] border-t-[1.5px] border-hairline bg-card"
          />
          {actions.map((action, index) => {
            const Icon = action.icon;
            const danger = action.tone === "danger";
            const className = `flex w-full items-center gap-2.5 rounded-lg px-[9px] py-2 text-left text-[12.5px] font-semibold outline-none ${
              danger
                ? "font-bold text-danger hover:bg-danger-bg focus-visible:bg-danger-bg"
                : "text-ink hover:bg-canvas focus-visible:bg-canvas"
            }`;
            return (
              <div key={action.label}>
                {danger && index > 0 && <div className="mx-1 my-1 h-px bg-[#EDF3FB]" />}
                {action.href ? (
                  <Link
                    href={action.href}
                    role="menuitem"
                    className={className}
                    onClick={() => select(action)}
                  >
                    <Icon size={14} strokeWidth={1.7} aria-hidden />
                    {action.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className={className}
                    onClick={() => select(action)}
                  >
                    <Icon size={14} strokeWidth={1.7} aria-hidden />
                    {action.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
