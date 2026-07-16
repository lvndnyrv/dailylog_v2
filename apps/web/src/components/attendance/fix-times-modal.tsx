"use client";

import type { Tables } from "@dailylog/db";
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
  onClose,
}: {
  childName: string;
  record: Tables<"attendance_records">;
  date: string;
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
        })
      : "";

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Fix {childName}&apos;s times</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Corrections are audit-logged with your name. Clear a field to unset it.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="record_id" value={record.id} />
        <input type="hidden" name="date" value={date} />

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="In" name="in_time" type="time" defaultValue={toTime(record.checked_in_at)} />
          <Field label="Out" name="out_time" type="time" defaultValue={toTime(record.checked_out_at)} />
        </div>

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
