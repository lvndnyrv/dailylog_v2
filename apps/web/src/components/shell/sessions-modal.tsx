"use client";

import { AdminSessionRow, type AdminSession } from "./admin-session";
import { Modal } from "@/components/ui/modal";

export function SessionsModal({
  sessions,
  loading,
  error,
  busy,
  actionError,
  onClose,
  onReview,
  onEndSession,
  onEndOthers,
}: {
  sessions: AdminSession[];
  loading: boolean;
  error: boolean;
  busy: boolean;
  actionError: string | null;
  onClose: () => void;
  onReview: (session: AdminSession) => void;
  onEndSession: (session: AdminSession) => void;
  onEndOthers: () => void;
}) {
  const otherSessions = sessions.filter((session) => !session.is_current);
  return (
    <Modal onClose={busy ? () => undefined : onClose} width={468}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Devices &amp; active sessions</h2>
        <p className="mt-1 text-[12.5px] leading-normal text-muted">
          Where your account is signed in. End anything you don&apos;t recognize.
        </p>
      </div>
      <div className="max-h-[45vh] divide-y divide-hairline overflow-y-auto rounded-[14px] border-[1.5px] border-hairline bg-canvas px-4 py-2">
        {loading ? <p role="status" className="py-3 text-xs text-muted">Loading sessions…</p>
          : error ? <p role="alert" className="py-3 text-xs text-danger">We couldn&apos;t load your sessions. Close and try again.</p>
          : sessions.length ? sessions.map((session) => (
            <div key={session.session_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <div className="min-w-0 flex-1"><AdminSessionRow session={session} /></div>
              {session.is_current ? <span className="rounded-full bg-success-bg px-2 py-1 text-[10px] font-bold text-success">This device</span> : (
                <div className="flex gap-1.5 pb-2 sm:pb-0">
                  <button type="button" disabled={busy} onClick={() => onReview(session)} className="rounded-full border border-hairline bg-card px-2.5 py-1.5 text-[11px] font-bold text-primary disabled:opacity-50">Review</button>
                  <button type="button" disabled={busy} onClick={() => onEndSession(session)} className="rounded-full border border-danger/30 bg-card px-2.5 py-1.5 text-[11px] font-bold text-danger disabled:opacity-50">End session</button>
                </div>
              )}
            </div>
          ))
          : <p className="py-3 text-xs text-muted">No active sessions were returned. Refresh your account before relying on this list.</p>}
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">
        Ending a session revokes its refresh token and is recorded in the audit log. An existing access token can remain usable until it expires.
      </p>
      {actionError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{actionError}</p>}
      <div className="flex gap-2.5">
        <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-btn border-[1.5px] border-hairline px-4 py-3 text-sm font-bold text-ink disabled:opacity-50">Close</button>
        <button type="button" onClick={onEndOthers} disabled={busy || loading || error || otherSessions.length === 0} className="flex-1 rounded-btn bg-danger px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Ending…" : "End all other sessions"}</button>
      </div>
    </Modal>
  );
}
