"use client";

import { useActionState, useState } from "react";
import { signOutWithStateAction } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { AdminSessionRow, type AdminSession } from "./admin-session";

// Sign-out confirmation 14b. Device list arrives with the sessions feature —
// this ships the confirm + "end every session" toggle.
export function SignOutModal({
  profile,
  daycareName,
  sessions,
  sessionsLoading,
  initialEverywhere = false,
  onClose,
}: {
  profile: { full_name: string; email: string; role: string };
  daycareName: string;
  sessions: AdminSession[];
  sessionsLoading: boolean;
  initialEverywhere?: boolean;
  onClose: () => void;
}) {
  const [everywhere, setEverywhere] = useState(initialEverywhere);
  const [state, action, pending] = useActionState(signOutWithStateAction, {});
  const otherSessions = sessions.filter((session) => !session.is_current);

  return (
    <Modal onClose={pending ? () => undefined : onClose}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Sign out of DailyLog?</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Anything you&apos;ve saved stays. Anything unsaved on this browser is dropped.
        </p>
      </div>

      <div className="flex items-center gap-[11px] rounded-[14px] border-[1.5px] border-[#D6E1F0] bg-canvas px-4 py-3.5">
        <Avatar name={profile.full_name} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-ink">
            {profile.full_name} · {profile.role === "owner_admin" ? "Owner admin" : "Admin"}
          </span>
          <span className="block text-[11.5px] text-muted">{daycareName}</span>
        </span>
      </div>

      {!sessionsLoading && otherSessions.length > 0 && (
        <div className="rounded-[14px] border border-hairline px-4 py-2">
          <p className="py-1 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-faint">
            Other active sessions — {otherSessions.length}
          </p>
          {otherSessions.slice(0, 3).map((session) => <AdminSessionRow key={session.session_id} session={session} />)}
          {otherSessions.length > 3 && <p className="pb-1 text-xs text-muted">And {otherSessions.length - 3} more active sessions</p>}
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2.5">
        <span className="flex-1">
          <span className="block text-[13px] font-bold text-ink">
            Sign out of every device too
          </span>
          <span className="block text-[11.5px] text-muted">
            Revokes other devices&apos; refresh tokens; existing access may last until token expiry.
          </span>
        </span>
        <input
          type="checkbox"
          checked={everywhere}
          onChange={(e) => setEverywhere(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
            everywhere ? "bg-primary" : "bg-[#D6E1F0]"
          }`}
          aria-hidden
        >
          <span
            className={`absolute top-0.5 size-[18px] rounded-full bg-white transition-all ${
              everywhere ? "right-0.5" : "left-0.5"
            }`}
          />
        </span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
          {state.error}
        </p>
      )}
      <form action={action} className="flex gap-2.5">
        {everywhere && <input type="hidden" name="everywhere" value="1" />}
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="flex-1 rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas"
        >
          Stay signed in
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-btn bg-danger px-4 py-3 text-sm font-bold text-white hover:brightness-95"
        >
          {pending ? "Signing out…" : "Sign out"}
        </button>
      </form>
    </Modal>
  );
}
