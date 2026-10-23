"use client";

import { Check, KeyRound, LogOut, Settings2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { ProfileModal } from "./profile-modal";
import { SignOutModal } from "./sign-out-modal";
import { useNotificationCenter } from "@/components/notifications/notification-center";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { deviceLabel, type AdminSession } from "./admin-session";
import { SessionsModal } from "./sessions-modal";

// Account menu 14a — popover anchored above the sidebar's avatar footer.
export function AccountMenu({
  profile,
  daycareName,
  initialModal = "none",
  initialReviewSessionId = null,
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
  initialModal?: "none" | "sessions";
  initialReviewSessionId?: string | null;
  onClose: () => void;
}) {
  const [modal, setModal] = useState<"none" | "profile" | "sessions" | "review" | "confirmed" | "signout">(initialModal);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(false);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [reviewSession, setReviewSession] = useState<AdminSession | null>(null);
  const [endedCount, setEndedCount] = useState(0);
  const [endAll, setEndAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { openSettings } = useNotificationCenter();

  async function reloadSessions() {
    const { data, error } = await getBrowserSupabase().rpc("list_my_admin_sessions");
    if (error) throw error;
    setSessions(data ?? []);
    setSessionsError(false);
  }

  async function endSession(session: AdminSession) {
    if (session.is_current || sessionBusy) return;
    setSessionActionError(null);
    setSessionBusy(true);
    try {
      const { data, error } = await getBrowserSupabase().rpc("end_my_admin_session", { p_session_id: session.session_id });
      if (error || !data) throw error ?? new Error("Session no longer active");
      setSessions((current) => current.filter((item) => item.session_id !== session.session_id));
      setReviewSession(null);
      setEndedCount(1);
      setModal("confirmed");
    } catch {
      setSessionActionError("Could not end this session. Refresh the list and try again.");
      setModal("sessions");
    } finally {
      setSessionBusy(false);
    }
  }

  async function endOtherSessions() {
    if (sessionBusy) return;
    const count = sessions.filter((session) => !session.is_current).length;
    if (!count) return;
    setSessionActionError(null);
    setSessionBusy(true);
    try {
      const { error } = await getBrowserSupabase().auth.signOut({ scope: "others" });
      if (error) throw error;
      setSessions((current) => current.filter((session) => session.is_current));
      void reloadSessions().catch(() => undefined);
      setEndedCount(count);
      setReviewSession(null);
      setModal("confirmed");
    } catch {
      setSessionActionError("Could not confirm that other sessions ended. Refresh and try again.");
      setModal("sessions");
    } finally {
      setSessionBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await getBrowserSupabase().rpc("list_my_admin_sessions");
        if (!active) return;
        setSessions(data ?? []);
        setSessionsError(Boolean(error));
        if (!error && initialReviewSessionId) {
          const target = data?.find((session) => session.session_id === initialReviewSessionId && !session.is_current);
          if (target) {
            setReviewSession(target);
            setModal("review");
          } else {
            setSessionActionError("This sign-in is no longer in your active session list.");
          }
        }
      } catch {
        if (!active) return;
        setSessionsError(true);
      } finally {
        if (active) setSessionsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [initialReviewSessionId]);

  useEffect(() => {
    if (modal === "none") {
      ref.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
    }
  }, [modal]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal !== "none") return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!ref.current?.contains(document.activeElement)) return;
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown"
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
      items[next]?.focus();
      e.preventDefault();
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
        <button type="button" role="menuitem" className={item} onClick={() => setModal("sessions")}>
          <KeyRound size={14} strokeWidth={1.75} aria-hidden />
          Devices &amp; active sessions
          <span className="ml-auto text-[10px] font-bold text-faint">{sessionsLoading ? "…" : sessionsError ? "!" : sessions.length}</span>
        </button>

        <span className="mx-1 my-1 h-px bg-[#EDF3FB]" />

        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg p-2 px-2 py-[9px] text-left text-[13px] font-bold text-danger hover:bg-danger-bg"
          onClick={() => { setEndAll(false); setModal("signout"); }}
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
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          initialEverywhere={endAll}
          onClose={() => {
            setModal("none");
            onClose();
          }}
        />
      )}
      {modal === "sessions" && (
        <SessionsModal
          sessions={sessions}
          loading={sessionsLoading}
          error={sessionsError}
          busy={sessionBusy}
          actionError={sessionActionError}
          onClose={() => { setModal("none"); onClose(); }}
          onReview={(session) => { setSessionActionError(null); setReviewSession(session); setModal("review"); }}
          onEndSession={(session) => { void endSession(session); }}
          onEndOthers={() => { void endOtherSessions(); }}
        />
      )}
      {modal === "review" && reviewSession && (
        <SessionReviewModal
          session={reviewSession}
          busy={sessionBusy}
          onBack={() => setModal("sessions")}
          onSecure={() => { void endOtherSessions(); }}
        />
      )}
      {modal === "confirmed" && (
        <Modal onClose={() => { setModal("none"); onClose(); }} width={400}>
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-success-bg text-success"><Check size={27} aria-hidden /></span>
            <h2 className="text-[19px] font-extrabold text-ink">{endedCount === 1 ? "Session ended" : "Other sessions ended"}</h2>
            <p className="text-[12.5px] leading-relaxed text-muted">{endedCount} other {endedCount === 1 ? "session's" : "sessions'"} refresh access was revoked. You remain signed in here. Existing access tokens may work until expiry.</p>
          </div>
          <a href="/forgot" className="rounded-btn bg-primary px-4 py-3 text-center text-sm font-bold text-white">Change your password</a>
          <button type="button" onClick={() => { setModal("none"); onClose(); }} className="rounded-btn border-[1.5px] border-hairline px-4 py-3 text-sm font-bold text-ink">Done</button>
          <p className="text-center text-[11px] text-muted">Session ends are recorded in the audit log.</p>
        </Modal>
      )}
    </>
  );
}

function SessionReviewModal({
  session,
  busy,
  onBack,
  onSecure,
}: {
  session: AdminSession;
  busy: boolean;
  onBack: () => void;
  onSecure: () => void;
}) {
  const signedIn = new Date(session.created_at);
  const details = [
    ["Device", deviceLabel(session.user_agent)],
    ["Where", "Location unavailable"],
    ["When", Number.isNaN(signedIn.getTime()) ? "Unknown" : signedIn.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })],
    ["IP", session.ip_address?.replace(/\/(32|128)$/, "") ?? "Unavailable"],
  ];
  return (
    <Modal onClose={busy ? () => undefined : onBack}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Was this you?</h2>
        <p className="mt-1 text-[12.5px] text-muted">Review this sign-in to your account.</p>
      </div>
      <dl className="rounded-[14px] border-[1.5px] border-hairline bg-canvas px-4">
        {details.map(([label, value]) => (
          <div key={label} className="flex gap-3 border-b border-hairline py-3 text-[12.5px] last:border-0">
            <dt className="w-[62px] flex-none font-bold text-faint">{label}</dt>
            <dd className="min-w-0 break-words font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" disabled={busy} onClick={onBack} className="rounded-btn border-[1.5px] border-hairline px-4 py-3 text-sm font-bold text-ink disabled:opacity-50">Yes, that was me</button>
      <button type="button" disabled={busy} onClick={onSecure} className="rounded-btn bg-danger px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Securing…" : "No — secure my account"}</button>
      <p className="text-center text-[11px] leading-relaxed text-muted">This ends all other refresh sessions. Change your password next if you don&apos;t recognize the device.</p>
    </Modal>
  );
}
