"use client";

import { useActionState } from "react";
import { checkInAction, type AttendanceActionState } from "@/lib/attendance/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Manual check-in from the admin console ("Check in a child" on 8a).
export function CheckInModal({
  expected,
  date,
  onClose,
}: {
  expected: { id: string; name: string; room: string | null }[];
  date: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<AttendanceActionState, FormData>(
    checkInAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Check in a child</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Time-stamped now, signed by you. The room&apos;s live ratio updates
          immediately.
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Checked in.</b>
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="date" value={date} />

          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Child</span>
            <select
              name="child_id"
              defaultValue=""
              required
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
            >
              <option value="" disabled>
                Who just arrived?
              </option>
              {expected.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                  {child.room ? ` · ${child.room}` : ""}
                </option>
              ))}
            </select>
          </label>

          <Field
            label="Dropped off by"
            name="dropped_off_by"
            placeholder="e.g. Mom, Rosa Torres"
          />
          <Field label="Note for the day (optional)" name="notes" placeholder="slept poorly, watch at nap" />

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Checking in…" : "Check in"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
