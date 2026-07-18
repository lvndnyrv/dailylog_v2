"use client";

import { KeyRound, LogOut, Settings2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { ProfileModal } from "./profile-modal";
import { SignOutModal } from "./sign-out-modal";
import { useNotificationCenter } from "@/components/notifications/notification-center";

// Account menu 14a — popover anchored above the sidebar's avatar footer.
export function AccountMenu({
  profile,
  daycareName,
  onClose,
}: {
  profile: {
    full_name: string;
    display_name: string | null;
    email: string;
    role: string;
    phone: string | null;
    avatar_url: string | null;
    mfa_enabled: boolean;
  };
  daycareName: string;
  onClose: () => void;
}) {
  const [modal, setModal] = useState<"none" | "profile" | "signout">("none");
  const ref = useRef<HTMLDivElement>(null);
  const { openSettings } = useNotificationCenter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (modal === "none" && ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose, modal]);

  const item =
    "flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-[13px] font-semibold text-ink hover:bg-canvas";

  return (
    <>
      <div
        ref={ref}
        role="menu"
        className="absolute bottom-[74px] left-3.5 z-40 flex w-[296px] flex-col gap-1.5 rounded-[14px] border-[1.5px] border-hairline bg-card px-3 pb-3 pt-3.5"
        style={{ boxShadow: "0 14px 40px rgba(23,51,91,.22)" }}
      >
        <div className="flex items-center gap-2.5 border-b border-[#EDF3FB] px-1.5 pb-2.5">
          <Avatar name={profile.full_name} src={profile.avatar_url} size={38} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-bold text-ink">
              {profile.full_name}
            </span>
            <span className="block truncate text-[11.5px] text-muted">{profile.email}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 px-1.5 pb-1 pt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[.08em] text-faint">
          <span className="grid size-5 flex-none place-items-center rounded-[5px] bg-warning-bg">
            <span className="size-[9px] rounded-full bg-warning" />
          </span>
          <span className="min-w-0 truncate">
            {daycareName} · {profile.role === "owner_admin" ? "owner admin" : profile.role}
          </span>
        </div>

        <button type="button" role="menuitem" className={item} onClick={() => setModal("profile")}>
          <UserRound size={14} strokeWidth={1.75} aria-hidden />
          Your profile &amp; password
        </button>
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            openSettings();
            onClose();
          }}
        >
          <Settings2 size={14} strokeWidth={1.75} aria-hidden />
          Notification &amp; language preferences
        </button>
        <button type="button" role="menuitem" className={`${item} text-muted`} disabled>
          <KeyRound size={14} strokeWidth={1.75} aria-hidden />
          Devices &amp; active sessions
          <span className="ml-auto text-[10px] font-bold text-faint">Later</span>
        </button>

        <span className="mx-1 my-1 h-px bg-[#EDF3FB]" />

        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg p-2 px-2 py-[9px] text-left text-[13px] font-bold text-danger hover:bg-danger-bg"
          onClick={() => setModal("signout")}
        >
          <LogOut size={14} strokeWidth={1.8} aria-hidden />
          Sign out
        </button>

        <span
          className="absolute -bottom-[9px] left-[38px] size-4 rotate-45 border-b-[1.5px] border-r-[1.5px] border-hairline bg-card"
          aria-hidden
        />
      </div>

      {modal === "profile" && (
        <ProfileModal
          profile={profile}
          daycareName={daycareName}
          onClose={() => {
            setModal("none");
            onClose();
          }}
        />
      )}
      {modal === "signout" && (
        <SignOutModal
          profile={profile}
          daycareName={daycareName}
          onClose={() => {
            setModal("none");
            onClose();
          }}
        />
      )}
    </>
  );
}
