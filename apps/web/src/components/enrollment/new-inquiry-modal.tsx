"use client";

import { useActionState, useState } from "react";
import { newInquiryAction, type EnrollmentActionState } from "@/lib/enrollment/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Add family 2g (admin side) — a walk-in or phone inquiry.
export function NewInquiryModal({
  classrooms,
  onClose,
}: {
  classrooms: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(
    newInquiryAction,
    {},
  );
  const [source, setSource] = useState("walk-in");
  const [skipToWaitlist, setSkipToWaitlist] = useState(false);

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Add a family</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          For walk-ins, phone calls and referrals — this lands in the enrollment pipeline.
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
          <fieldset>
            <legend className="mb-2 text-[13px] font-bold text-ink">How they reached you</legend>
            <input type="hidden" name="source" value={source} />
            <div className="flex gap-2">
              {[{ value: "walk-in", label: "Walk-in" }, { value: "phone", label: "Phone" }, { value: "referral", label: "Referral" }].map((option) => (
                <button key={option.value} type="button" onClick={() => setSource(option.value)} className={`flex-1 rounded-full border-[1.5px] px-3 py-2 text-[12px] font-bold ${source === option.value ? "border-primary bg-primary text-white" : "border-[#D6E1F0] bg-card text-muted"}`}>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Parent / guardian" name="guardian_name" placeholder="Full name" required />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Email" name="guardian_email" type="email" />
            <Field label="Phone" name="guardian_phone" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Child's first name" name="child_first_name" />
            <Field label="Child's birthday" name="child_date_of_birth" type="date" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-[7px]">
              <span className="text-[13px] font-bold text-ink">Program</span>
              <select name="classroom_id" defaultValue="" required={skipToWaitlist} className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[14px] text-ink outline-none focus:border-primary">
                <option value="">Not sure yet</option>
                {classrooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
            </label>
            <Field label="Desired start" name="desired_start" type="date" />
          </div>

          <label className="flex items-center gap-3 rounded-[13px] bg-canvas px-3.5 py-3">
            <span className="flex-1">
              <span className="block text-[13px] font-bold text-ink">Skip straight to the waitlist</span>
              <span className="block text-[11.5px] text-muted">For families who already know they want in.</span>
            </span>
            <input name="skip_to_waitlist" type="checkbox" checked={skipToWaitlist} onChange={(event) => setSkipToWaitlist(event.target.checked)} className="size-4 accent-primary" />
          </label>

          <p className="text-center text-[11px] leading-relaxed text-faint">
            They receive the welcome email with tour options, just like a website inquiry.
          </p>

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
