"use client";

import { Bell, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Per-section header: title/subtitle, search, "+ New" create menu (18b), bell
// (15a — empty tray stub in Phase 1). Location switcher 18d hidden (single
// center). `actions` lets a section swap "+ New" for its own primary action.
export function SectionHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState<"none" | "new" | "bell">("none");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen("none");
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen("none");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  const createItem =
    "flex items-center gap-2.5 rounded-lg p-2 text-[13px] font-semibold text-ink hover:bg-canvas";

  return (
    <div className="flex items-center gap-3.5 bg-card px-7 pb-4 pt-5">
      <span className="min-w-0">
        <span className="block text-[22px] font-extrabold text-ink">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block text-[12.5px] text-muted">{subtitle}</span>
        )}
      </span>
      <span className="flex-1" />

      <label className="flex w-[190px] items-center gap-2 rounded-full border-[1.5px] border-[#D6E1F0] bg-canvas px-3.5 py-[9px]">
        <Search size={13} strokeWidth={1.8} className="text-faint" aria-hidden />
        <input
          type="search"
          placeholder="Search…"
          className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
          aria-label={`Search ${title.toLowerCase()}`}
        />
      </label>

      <div className="relative flex items-center gap-2" ref={ref}>
        <button
          type="button"
          aria-label="Notifications"
          aria-expanded={open === "bell"}
          onClick={() => setOpen(open === "bell" ? "none" : "bell")}
          className="grid size-9 place-items-center rounded-full border-[1.5px] border-[#D6E1F0] bg-card text-body hover:bg-canvas"
        >
          <Bell size={15} strokeWidth={1.75} aria-hidden />
        </button>

        {actions ?? (
          <button
            type="button"
            aria-expanded={open === "new"}
            onClick={() => setOpen(open === "new" ? "none" : "new")}
            className="rounded-btn bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
          >
            + New
          </button>
        )}

        {open === "new" && (
          <div
            className="absolute right-0 top-11 z-40 flex w-56 flex-col gap-1 rounded-[14px] border-[1.5px] border-hairline bg-card p-2.5"
            style={{ boxShadow: "0 14px 40px rgba(23,51,91,.22)" }}
            role="menu"
          >
            <span className="px-2 pb-1 pt-0.5 font-mono text-[10px] font-semibold tracking-[.08em] text-faint">
              CREATE
            </span>
            <Link href="/children?new=1" role="menuitem" className={createItem}>
              Child · profile
            </Link>
            <Link href="/staff?invite=1" role="menuitem" className={createItem}>
              Invite educator
            </Link>
            <span className={`${createItem} cursor-default text-muted`}>
              Invoice <span className="ml-auto text-[10px] font-bold text-faint">Phase 4</span>
            </span>
            <span className={`${createItem} cursor-default text-muted`}>
              Incident report <span className="ml-auto text-[10px] font-bold text-faint">Phase 2</span>
            </span>
            <span className={`${createItem} cursor-default text-muted`}>
              Broadcast <span className="ml-auto text-[10px] font-bold text-faint">Phase 3</span>
            </span>
          </div>
        )}

        {open === "bell" && (
          <div
            className="absolute right-0 top-11 z-40 flex w-72 flex-col items-center gap-2 rounded-[14px] border-[1.5px] border-hairline bg-card px-5 py-8 text-center"
            style={{ boxShadow: "0 14px 40px rgba(23,51,91,.22)" }}
            role="status"
          >
            <span className="grid size-10 place-items-center rounded-full bg-tint">
              <Bell size={16} strokeWidth={1.75} className="text-primary" aria-hidden />
            </span>
            <span className="text-[13px] font-bold text-ink">You&apos;re all caught up</span>
            <span className="text-[11.5px] leading-normal text-muted">
              Notifications land here once daily operations go live.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
