"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_ITEMS } from "./nav-config";
import { AccountMenu } from "./account-menu";
import { Avatar } from "@/components/ui/avatar";

const ROLE_LABELS: Record<string, string> = {
  owner_admin: "Owner admin",
  admin: "Admin",
};

export function Sidebar({
  daycareName,
  profile,
}: {
  daycareName: string;
  profile: { full_name: string; email: string; role: string };
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <aside className="relative flex w-[214px] flex-none flex-col gap-[3px] border-r-[1.5px] border-hairline bg-card px-3 pb-4 pt-[18px]">
      <div className="mb-4 flex items-center gap-2.5 px-2.5">
        <span className="grid size-[34px] flex-none place-items-center rounded-full bg-warning-bg">
          <span
            className="size-4 rounded-full bg-warning"
            style={{ boxShadow: "0 0 0 3px rgba(240,180,65,.3)" }}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-extrabold text-ink">
            {daycareName}
          </span>
          <span className="block text-[10.5px] font-semibold text-faint">ADMIN</span>
        </span>
      </div>

      <nav className="flex flex-col gap-[3px]" aria-label="Sections">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-[11px] px-3 py-[9px] text-[13px] ${
                active
                  ? "bg-primary font-bold text-white"
                  : "font-semibold text-body hover:bg-canvas"
              }`}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <span className="flex-1" />

      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`flex items-center gap-[9px] rounded-xl px-2.5 py-1.5 text-left ${
          menuOpen ? "border-[1.5px] border-[#D6E1F0] bg-canvas" : "hover:bg-canvas"
        }`}
      >
        <Avatar name={profile.full_name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-bold text-ink">
            {profile.full_name}
          </span>
          <span className="block text-[11px] text-faint">
            {ROLE_LABELS[profile.role] ?? profile.role}
          </span>
        </span>
      </button>

      {menuOpen && (
        <AccountMenu
          profile={profile}
          daycareName={daycareName}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </aside>
  );
}
