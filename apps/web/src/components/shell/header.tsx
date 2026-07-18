"use client";

import {
  Bell,
  Megaphone,
  ReceiptText,
  Search,
  TriangleAlert,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NotificationTray } from "@/components/notifications/notification-tray";
import { useNotificationCenter } from "@/components/notifications/notification-center";

// Per-section header: title/subtitle, search, "+ New" create menu (18b), bell
// (15a — empty tray stub in Phase 1). Location switcher 18d hidden (single
// center). `actions` lets a section swap "+ New" for its own primary action.
export function SectionHeader({
  title,
  subtitle,
  actions,
  showUtilities = true,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  showUtilities?: boolean;
}) {
  const [open, setOpen] = useState<"none" | "new" | "bell">("none");
  const ref = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const { unreadCount } = useNotificationCenter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen((current) => {
          if (current === "bell") queueMicrotask(() => bellRef.current?.focus());
          return "none";
        });
      }
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

  return (
    <div className="flex items-center gap-3.5 bg-card px-7 pb-4 pt-5">
      <span className="min-w-0">
        <span className="block text-[22px] font-extrabold text-ink">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block text-[12.5px] text-muted">{subtitle}</span>
        )}
      </span>
      <span className="flex-1" />

      {showUtilities && (
        <label className="flex w-[190px] items-center gap-2 rounded-full border-[1.5px] border-[#D6E1F0] bg-canvas px-3.5 py-[9px]">
          <Search size={13} strokeWidth={1.8} className="text-faint" aria-hidden />
          <input
            type="search"
            placeholder="Search…"
            className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
            aria-label={`Search ${title.toLowerCase()}`}
          />
        </label>
      )}

      <div className="relative flex items-center gap-2" ref={ref}>
        {showUtilities && (
          <button
            ref={bellRef}
            type="button"
            aria-label="Notifications"
            aria-expanded={open === "bell"}
            aria-haspopup="dialog"
            aria-controls="notification-tray"
            onClick={() => setOpen(open === "bell" ? "none" : "bell")}
            className={`relative grid size-10 place-items-center rounded-[11px] border-[1.5px] transition-colors ${
              open === "bell"
                ? "border-[#BFD6F2] bg-[#EAF1FB] text-primary"
                : "border-hairline bg-card text-body hover:bg-canvas"
            }`}
          >
            <Bell size={17} strokeWidth={1.7} aria-hidden />
            {unreadCount > 0 && (
              <span className="absolute -right-[5px] -top-[5px] grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-danger px-1 text-[10px] font-extrabold leading-none text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        )}

        {actions ?? (showUtilities ? (
          <button
            type="button"
            aria-expanded={open === "new"}
            aria-haspopup="menu"
            aria-controls="global-create-menu"
            onClick={() => setOpen(open === "new" ? "none" : "new")}
            className="rounded-btn bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
          >
            + New
          </button>
        ) : null)}

        {open === "new" && (
          <>
            <button
              type="button"
              aria-label="Close create menu"
              onMouseDown={() => setOpen("none")}
              className="fixed inset-x-0 bottom-0 top-[76px] z-30 cursor-default bg-[rgba(23,51,91,.10)]"
            />
            <div
              id="global-create-menu"
              className="absolute right-0 top-[46px] z-40 flex w-[260px] max-w-[calc(100vw-2rem)] flex-col gap-px rounded-[14px] border-[1.5px] border-hairline bg-card p-[7px]"
              style={{ boxShadow: "0 16px 44px rgba(23,51,91,.22)" }}
              role="menu"
              aria-label="Create"
            >
              <span
                aria-hidden
                className="absolute -top-2 right-6 size-3.5 rotate-45 border-l-[1.5px] border-t-[1.5px] border-hairline bg-card"
              />
              <span className="px-2.5 pb-1 pt-2 font-mono text-[9.5px] font-bold tracking-[.08em] text-faint">
                CREATE
              </span>
              <CreateMenuItem
                href="/children?new=1"
                icon={UserRound}
                iconClassName="bg-[#E3EDFA] text-primary"
                onSelect={() => setOpen("none")}
              >
                Child · profile
              </CreateMenuItem>
              <CreateMenuItem
                href="/staff?invite=1"
                icon={UserPlus}
                iconClassName="bg-[#E4F3EC] text-success"
                onSelect={() => setOpen("none")}
              >
                Invite educator
              </CreateMenuItem>
              <CreateMenuItem
                href="/billing?new=1"
                icon={ReceiptText}
                iconClassName="bg-[#F0EAFB] text-[#7A5FD0]"
                onSelect={() => setOpen("none")}
              >
                Invoice
              </CreateMenuItem>
              <CreateMenuItem
                href="/dashboard?review=incident"
                icon={TriangleAlert}
                iconClassName="bg-[#FBF3E4] text-[#B0782B]"
                onSelect={() => setOpen("none")}
              >
                Incident report
              </CreateMenuItem>
              <CreateMenuItem
                href="/messages?broadcast=1"
                icon={Megaphone}
                iconClassName="bg-[#FAE7E7] text-danger"
                onSelect={() => setOpen("none")}
              >
                Broadcast
              </CreateMenuItem>
            </div>
          </>
        )}

        {open === "bell" && (
          <>
            <button
              type="button"
              aria-label="Close notifications"
              onMouseDown={() => setOpen("none")}
              className="fixed inset-x-0 bottom-0 top-[76px] z-30 cursor-default bg-[rgba(23,51,91,.10)]"
            />
            <div id="notification-tray">
              <NotificationTray onClose={() => setOpen("none")} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CreateMenuItem({
  href,
  icon: Icon,
  iconClassName,
  onSelect,
  children,
}: {
  href: string;
  icon: LucideIcon;
  iconClassName: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-[11px] rounded-[9px] px-2.5 py-[9px] text-[13px] font-semibold text-ink outline-none hover:bg-canvas focus-visible:bg-canvas focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span className={`grid size-7 flex-none place-items-center rounded-lg ${iconClassName}`}>
        <Icon size={15} strokeWidth={1.7} aria-hidden />
      </span>
      {children}
    </Link>
  );
}
