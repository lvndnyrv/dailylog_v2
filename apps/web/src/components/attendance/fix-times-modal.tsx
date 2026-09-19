"use client";

import type { Tables } from "@dailylog/db";
import type { AttendanceCorrectionRow } from "@dailylog/db/queries";
import { useActionState } from "react";
import { fixTimesAction, type AttendanceActionState } from "@/lib/attendance/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Fix check-out 8c — correct a missed or mistyped time after the fact.
export function FixTimesModal({
  childName,
  record,
  date,
  corrections,
  timeZone,
  onClose,
}: {
  childName: string;
  record: Tables<"attendance_records">;
  date: string;
  corrections: AttendanceCorrectionRow[];
  timeZone: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<AttendanceActionState, FormData>(
    fixTimesAction,
    {},
  );

  const toTime = (timestamp: string | null) =>
    timestamp
      ? new Date(timestamp).toLocaleTimeString("en-CA", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          timeZone,
        })
      : "";

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Fix a missing check-out</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          {childName} · {date}. The original record stays in the audit trail.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="record_id" value={record.id} />
        <input type="hidden" name="date" value={date} />

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="In" name="in_time" type="time" defaultValue={toTime(record.checked_in_at)} />
          <Field label="Out" name="out_time" type="time" defaultValue={toTime(record.checked_out_at)} />
        </div>

        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">How you know</span>
          <select
            name="source"
            required
            defaultValue="parent_confirmed"
            className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
          >
            <option value="parent_confirmed">Parent confirmed</option>
            <option value="staff_witnessed">Staff member witnessed</option>
            <option value="kiosk_review">Kiosk record reviewed</option>
            <option value="other">Other evidence</option>
          </select>
        </label>
        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">Correction note</span>
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={2}
            placeholder="e.g. Parent confirmed pickup at 5:32 PM"
            className="resize-none rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-primary"
          />
        </label>

        {corrections.length > 0 && (
          <div className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-[#F8FAFD] px-4 py-3">
            <p className="text-[11.5px] font-bold text-ink">Correction history</p>
            {corrections.slice(0, 3).map((correction) => (
              <p key={correction.id} className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
                {new Date(correction.corrected_at).toLocaleString("en-CA", { timeZone })} · {correction.reason}
                {correction.corrected_by_profile?.full_name
                  ? ` · edited by ${correction.corrected_by_profile.full_name}`
                  : ""}
              </p>
            ))}
          </div>
        )}

        {state.ok && (
          <Notice tone="success">
            <b>Fixed.</b>
          </Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Saving…" : "Save times"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
