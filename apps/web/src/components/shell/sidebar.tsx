"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";
import { AccountMenu } from "./account-menu";
import { Avatar } from "@/components/ui/avatar";
import type { DaycareLocationRow } from "@dailylog/db/queries";
import { LocationSwitcher } from "./location-switcher";

const ROLE_LABELS: Record<string, string> = {
  owner_admin: "Owner admin",
  admin: "Admin",
};

// The sidebar uses the compact brand from the handoff while account surfaces
// keep the center's full legal/display name. Common business descriptors make
// otherwise short brands wrap or truncate inside the fixed 214px rail.
function compactCenterName(name: string) {
  const compact = name
    .replace(
      /\s+(?:early learning(?: center| centre)?|childcare|daycare(?: center| centre)?|learning center|learning centre)$/i,
      "",
    )
    .trim();
  return compact || name;
}

export function Sidebar({
  daycareName,
  profile,
  badges = {},
  locations = [],
}: {
  daycareName: string;
  profile: {
    full_name: string;
    display_name: string | null;
    email: string;
    role: string;
    phone: string | null;
    avatar_url: string | null;
    mfa_enabled: boolean;
  };
  badges?: Record<string, number>;
  locations?: DaycareLocationRow[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionsRequested = pathname === "/settings" && searchParams.get("account") === "sessions";
  const reviewSessionId = sessionsRequested ? searchParams.get("session") : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const restoreSessionFocusRef = useRef(false);
  const brandName = compactCenterName(daycareName);
  const showAccountMenu = menuOpen || sessionsRequested;

  useEffect(() => {
    if (!sessionsRequested && restoreSessionFocusRef.current) {
      restoreSessionFocusRef.current = false;
      accountButtonRef.current?.focus();
    }
  }, [sessionsRequested]);

  return (
    <>
    <div className="sticky top-0 z-50 flex h-14 flex-none items-center gap-3 border-b border-hairline bg-card px-4 print:hidden md:hidden">
      <button type="button" onClick={() => setMobileOpen((open) => !open)} aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="admin-sidebar" className="grid size-9 place-items-center rounded-lg text-ink hover:bg-canvas">
        {mobileOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
      </button>
      <span className="truncate text-[14px] font-extrabold text-ink">{brandName} <span className="text-[10px] font-semibold text-faint">ADMIN</span></span>
    </div>
    {mobileOpen && <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-x-0 bottom-0 top-14 z-30 bg-[#17335B]/35 print:hidden md:hidden" />}
    <aside id="admin-sidebar" className={`fixed bottom-0 left-0 top-14 z-40 flex w-[214px] flex-none flex-col border-r-[1.5px] border-hairline bg-card px-3 pb-4 pt-[18px] transition-transform print:hidden md:sticky md:top-0 md:h-dvh md:translate-x-0 md:self-start ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="mb-4 flex flex-none items-center gap-2.5 px-2.5">
        <span className="grid size-[34px] flex-none place-items-center rounded-full bg-warning-bg">
          <span
            className="size-4 rounded-full bg-warning"
            style={{ boxShadow: "0 0 0 3px rgba(240,180,65,.3)" }}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-extrabold text-ink">
            {brandName}
          </span>
          <span className="block text-[10.5px] font-semibold text-faint">ADMIN</span>
        </span>
      </div>

      <nav
        className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Sections"
      >
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const badge = badges[href] ?? 0;
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-[11px] px-3 py-[9px] text-[13px] ${
                active
                  ? "bg-primary font-bold text-white"
                  : "font-semibold text-body hover:bg-canvas"
              }`}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden />
              {label}
              {badge > 0 && (
                <span
                  className={`ml-auto rounded-full px-[7px] py-[2px] text-[10.5px] font-bold ${
                    active
                      ? "bg-white/25 text-white"
                      : href === "/billing"
                        ? "bg-danger-bg text-danger"
                        : "bg-warning-bg text-warning-text"
                  }`}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-none flex-col pt-2">
        <LocationSwitcher locations={locations} />

        <button
          ref={accountButtonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={showAccountMenu}
          className={`flex items-center gap-[9px] rounded-xl px-2.5 py-1.5 text-left ${
            showAccountMenu ? "border-[1.5px] border-[#D6E1F0] bg-canvas" : "hover:bg-canvas"
          }`}
        >
          <Avatar name={profile.full_name} src={profile.avatar_url} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-bold text-ink">
              {profile.full_name}
            </span>
            <span className="block text-[11px] text-faint">
              {ROLE_LABELS[profile.role] ?? profile.role}
            </span>
          </span>
        </button>
      </div>

      {showAccountMenu && (
        <AccountMenu
          key={sessionsRequested ? `sessions:${reviewSessionId ?? "list"}` : "menu"}
          profile={profile}
          daycareName={daycareName}
          initialModal={sessionsRequested ? "sessions" : "none"}
          initialReviewSessionId={reviewSessionId}
          onClose={() => {
            setMenuOpen(false);
            if (sessionsRequested) {
              restoreSessionFocusRef.current = true;
              router.replace("/settings", { scroll: false });
            } else {
              accountButtonRef.current?.focus();
            }
          }}
        />
      )}
    </aside>
    </>
  );
}
