"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { publicInquiryAction, type EnrollmentActionState } from "@/lib/enrollment/actions";

export function InquiryForm({
  daycareId,
  programs,
}: {
  daycareId: string;
  programs: { id: string; name: string }[];
}) {
  const [program, setProgram] = useState(programs[0]?.id ?? "");
  const [days, setDays] = useState(5);
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(
    publicInquiryAction,
    {},
  );

  if (state.ok) {
    return (
      <Notice tone="success">
        <b>Thanks — your inquiry is in!</b> Check your email for confirmation. The
        center will send available tour times within one business day.
      </Notice>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <input type="hidden" name="daycare_id" value={daycareId} />
      <input type="hidden" name="classroom_id" value={program} />
      <input type="hidden" name="days_per_week" value={days} />

      <Field label="Your name" name="guardian_name" autoComplete="name" required />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Email" name="guardian_email" type="email" autoComplete="email" required />
        <Field label="Phone" name="guardian_phone" autoComplete="tel" />
      </div>
      <div className="grid grid-cols-[1.3fr_1fr] gap-2.5">
        <Field label="Child's first name" name="child_first_name" required />
        <Field label="Birthday" name="child_date_of_birth" type="month" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-bold text-ink">Program</legend>
        <div className="flex flex-wrap gap-1.5">
          {programs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={program === item.id}
              onClick={() => setProgram(item.id)}
              className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold ${
                program === item.id
                  ? "bg-primary text-white"
                  : "border-[1.5px] border-[#D6E1F0] bg-card text-muted"
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Hoping to start" name="desired_start" type="month" />
        <fieldset className="flex flex-col gap-[7px]">
          <legend className="text-[13px] font-bold text-ink">Days / week</legend>
          <div className="flex gap-1.5">
            {[5, 3, 2].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={days === value}
                onClick={() => setDays(value)}
                className={`flex-1 rounded-full py-2 text-[12px] font-bold ${
                  days === value
                    ? "bg-primary text-white"
                    : "border-[1.5px] border-[#D6E1F0] bg-card text-muted"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {state.error && <Notice tone="error">{state.error}</Notice>}

      <Button type="submit" disabled={pending} className="py-3 text-sm">
        {pending ? "Sending…" : "Send inquiry"}
      </Button>
      <p className="text-center text-[10.5px] leading-normal text-faint">
        No commitment — this just starts the conversation. We only use your
        details to reply about enrollment.
      </p>
    </form>
  );
}
