"use client";

import { useActionState } from "react";
import { publicInquiryAction, type EnrollmentActionState } from "@/lib/enrollment/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function InquiryForm({
  daycareId,
  programs,
}: {
  daycareId: string;
  programs: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(
    publicInquiryAction,
    {},
  );

  if (state.ok) {
    return (
      <Notice tone="success">
        <b>Thanks — you&apos;re in the queue!</b> We&apos;ll be in touch within one
        business day.
      </Notice>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <input type="hidden" name="daycare_id" value={daycareId} />

      <Field label="Your name" name="guardian_name" autoComplete="name" required />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Email" name="guardian_email" type="email" autoComplete="email" required />
        <Field label="Phone" name="guardian_phone" autoComplete="tel" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Child's first name" name="child_first_name" />
        <Field label="Child's birthday" name="child_date_of_birth" type="date" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">Program</span>
          <select
            name="classroom_id"
            defaultValue=""
            className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3 py-3 text-[14px] text-ink outline-none focus:border-primary"
          >
            <option value="">Not sure yet</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
        </label>
        <Field label="Hoping to start" name="desired_start" type="date" />
      </div>

      {state.error && <Notice tone="error">{state.error}</Notice>}

      <Button type="submit" disabled={pending} className="py-3 text-sm">
        {pending ? "Sending…" : "Send inquiry"}
      </Button>
      <p className="text-center text-[10.5px] leading-normal text-faint">
        We only use this to reply about enrollment — no newsletters, no sharing.
      </p>
    </form>
  );
}
