"use client";

import type { AttendanceDayRow, AttendanceFollowupRow } from "@dailylog/db/queries";
import Link from "next/link";
import { useActionState } from "react";
import {
  sendAttendanceFollowupAction,
  type AttendanceFollowupActionState,
} from "@/lib/attendance/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

export function AttendanceFollowupModal({
  child,
  date,
  followups,
  onClose,
}: {
  child: AttendanceDayRow;
  date: string;
  followups: AttendanceFollowupRow[];
  onClose: () => void;
}) {
  const defaultMessage = `Hi — just checking in. We were expecting ${child.first_name} this morning. All good? No need to call; you can report an absence in the DailyLog app.`;
  const [state, action, pending] = useActionState<AttendanceFollowupActionState, FormData>(
    sendAttendanceFollowupAction,
    {},
  );
  const latest = followups[0] ?? null;

  return (
    <Modal onClose={onClose} width={470}>
      <div>
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[.08em] text-faint">
          Attendance follow-up
        </p>
        <h2 className="mt-1 text-[19px] font-extrabold text-ink">
          {child.first_name} hasn&apos;t arrived
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          The child stays marked as unexplained until the family replies. A no-reply
          task is raised to admins after one hour so emergency contacts are not missed.
        </p>
      </div>

      {latest && (
        <div className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-[#F8FAFD] px-4 py-3">
          <p className="text-[12px] font-bold text-ink">
            Last follow-up · {new Date(latest.sent_at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{latest.message}</p>
          <p className="mt-1 text-[10.5px] font-semibold text-faint">
            {latest.resolved_at
              ? `Resolved · ${latest.resolution ?? "family replied"}`
              : `${latest.queued_recipients} deliveries queued · escalation at ${latest.escalation_due_at
                ? new Date(latest.escalation_due_at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })
                : "one hour"}`}
          </p>
        </div>
      )}

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Follow-up queued.</b> {state.queued ?? 0} family deliveries are ready.
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>Done</Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="child_id" value={child.id} />
          <input type="hidden" name="date" value={date} />
          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Message to all guardians</span>
            <textarea
              name="message"
              required
              minLength={3}
              maxLength={1000}
              rows={4}
              defaultValue={defaultMessage}
              className="resize-none rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[13px] leading-relaxed text-ink outline-none focus:border-primary"
            />
          </label>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Sending…" : "Text both parents"}
            </Button>
          </div>
          <Link
            href="/children"
            className="text-center text-[11.5px] font-bold text-primary hover:text-primary-hover"
          >
            Call instead · open family contacts →
          </Link>
        </form>
      )}
    </Modal>
  );
}
