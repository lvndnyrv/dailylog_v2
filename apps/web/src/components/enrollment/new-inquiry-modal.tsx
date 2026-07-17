"use client";

import { useActionState } from "react";
import { newInquiryAction, type EnrollmentActionState } from "@/lib/enrollment/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Add family 2g (admin side) — a walk-in or phone inquiry.
export function NewInquiryModal({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(
    newInquiryAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">New inquiry</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          A walk-in or phone inquiry — website ones arrive on their own.
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Added</b> to the pipeline.
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <Field label="Family / guardian name" name="guardian_name" required />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Email" name="guardian_email" type="email" />
            <Field label="Phone" name="guardian_phone" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Child's first name" name="child_first_name" />
            <Field label="Child's birthday" name="child_date_of_birth" type="date" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Desired start" name="desired_start" type="date" />
            <label className="flex flex-col gap-[7px]">
              <span className="text-[13px] font-bold text-ink">Source</span>
              <select
                name="source"
                defaultValue="walk-in"
                className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[15px] text-ink outline-none focus:border-primary"
              >
                <option value="walk-in">Walk-in</option>
                <option value="phone">Phone</option>
                <option value="referral">Referral</option>
                <option value="website">Website</option>
              </select>
            </label>
          </div>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Adding…" : "Add inquiry"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
