"use client";

import type { PendingStaffInvite } from "@dailylog/db/queries";
import { Check, ClipboardCopy, Clock3, Mail, ShieldCheck } from "lucide-react";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  resendInviteAction,
  revokeInviteAction,
  type StaffActionState,
} from "@/lib/staff/actions";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const ROLE_LABELS: Record<string, string> = {
  owner_admin: "Owner admin",
  admin: "Delegated admin",
  educator: "Educator",
};

function dateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function initials(value: string) {
  return value
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function StaffInviteLifecycleModal({
  invite,
  onClose,
}: {
  invite: PendingStaffInvite;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, resendAction, resending] = useActionState<StaffActionState, FormData>(
    resendInviteAction,
    {},
  );
  const [revoking, startRevocation] = useTransition();
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const expired = new Date(state.expiresAt ?? invite.expires_at ?? 0) <= new Date();
  const link = state.inviteLink ?? `${origin}/invite?code=${invite.code}`;
  const displayName = invite.full_name || invite.email.split("@")[0] || invite.email;
  const role = invite.job_title || ROLE_LABELS[invite.role] || invite.role;

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);

  const steps = useMemo(
    () => [
      {
        label: state.ok ? "Invite resent" : "Invite sent",
        detail: dateTime(state.ok ? new Date().toISOString() : invite.last_sent_at),
        done: !expired || Boolean(state.ok),
        current: expired && !state.ok,
      },
      {
        label: "Account created",
        detail: "Waiting for acceptance",
        done: false,
        current: !expired,
      },
      {
        label: invite.require_background_check ? "Background check" : "Center setup",
        detail: invite.require_background_check ? "Required before scheduling" : "Ready after acceptance",
        done: false,
        current: false,
      },
      { label: "Documents & certs", detail: "Educator uploads in the app", done: false, current: false },
      { label: "First shift", detail: "Admin schedules and announces", done: false, current: false },
    ],
    [expired, invite.last_sent_at, invite.require_background_check, state.ok],
  );

  return (
    <Modal onClose={onClose} width={790}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-full border-[1.5px] border-dashed border-[#8FA6C4] text-[12px] font-extrabold text-faint">
          {initials(displayName)}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[19px] font-extrabold text-ink">{displayName}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {role} · {invite.classroom?.name ?? "Floater"} · invited by {invite.inviter?.full_name ?? "an administrator"}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-faint">{invite.email}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close invitation" className="ml-auto grid size-8 flex-none place-items-center rounded-full bg-canvas text-muted hover:text-ink">
          ✕
        </button>
      </div>

      {expired && !state.ok && (
        <Notice tone="error">This link expired. Resend it to rotate the code and give the educator seven new days.</Notice>
      )}
      {state.ok && (
        <Notice tone={state.emailQueued ? "success" : "info"}>
          {state.emailQueued
            ? "A fresh invitation email is queued. The previous link no longer works."
            : "The link was renewed, but email could not be queued. Copy and send it manually."}
        </Notice>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}

      <div className="flex items-start gap-0 overflow-x-auto pb-1">
        {steps.map((step, index) => (
          <div key={step.label} className="contents">
            {index > 0 && <span className={`mt-[15px] h-[3px] min-w-6 flex-1 rounded-full ${steps[index - 1]?.done ? "bg-success" : "bg-[#EDF3FB]"}`} />}
            <div className="flex min-w-[112px] flex-1 flex-col items-center gap-1.5 text-center">
              <span className={`grid size-[32px] place-items-center rounded-full text-[12px] font-extrabold ${step.done ? "bg-success text-white" : step.current ? "border-[2.5px] border-warning bg-warning-bg text-warning-text" : "bg-[#EDF3FB] text-faint"}`}>
                {step.done ? <Check size={15} strokeWidth={2.5} /> : index + 1}
              </span>
              <span className={`text-[11.5px] font-bold ${step.current ? "text-warning-text" : step.done ? "text-ink" : "text-faint"}`}>{step.label}</span>
              <span className="max-w-[128px] text-[10.5px] leading-snug text-faint">{step.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[14px] bg-canvas px-4 py-3.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink"><Mail size={14} /> One-time invitation link</p>
          <p className="mt-1 truncate font-mono text-[11px] text-muted">{link}</p>
          <p className="mt-1 flex items-center gap-1 text-[10.5px] text-faint"><Clock3 size={12} /> Expires {dateTime(state.expiresAt ?? invite.expires_at)} · resent {state.ok ? invite.resend_count + 1 : invite.resend_count} time{(state.ok ? invite.resend_count + 1 : invite.resend_count) === 1 ? "" : "s"}</p>
        </div>
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }} className="flex items-center gap-1.5 rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3 py-2 text-[11.5px] font-bold text-primary hover:bg-white">
          <ClipboardCopy size={14} /> {copied ? "Copied ✓" : "Copy link"}
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-[14px] border border-[#E4ECF6] px-4 py-3.5">
        <ShieldCheck size={21} className="flex-none text-primary" />
        <p className="flex-1 text-[11.5px] leading-relaxed text-muted">
          Until the invitation is accepted, this person has no access to children, families, or center records.
          {invite.require_background_check && " After acceptance, scheduling stays blocked until the required background check clears."}
        </p>
      </div>

      <div className="flex justify-end gap-2.5">
        <button
          type="button"
          disabled={revoking || resending}
          onClick={() => startRevocation(async () => {
            const data = new FormData();
            data.set("invite_id", invite.id);
            await revokeInviteAction(data);
            onClose();
          })}
          className="rounded-btn border-[1.5px] border-[#F2D5D5] bg-card px-5 py-2.5 text-[12.5px] font-bold text-danger hover:bg-danger-bg disabled:opacity-60"
        >
          {revoking ? "Cancelling…" : "Cancel invitation"}
        </button>
        <form action={resendAction}>
          <input type="hidden" name="invite_id" value={invite.id} />
          <button type="submit" disabled={resending || revoking} className="rounded-btn bg-primary px-5 py-2.5 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-60">
            {resending ? "Resending…" : expired ? "Renew & resend" : "Resend invite"}
          </button>
        </form>
      </div>
    </Modal>
  );
}
