"use client";

import { useActionState } from "react";
import { startCenterAction, type ActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { RuleHint } from "@/components/ui/rule-hint";

export function StartForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    startCenterAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Center name" name="center_name" required />
      <Field label="Your name" name="full_name" autoComplete="name" required />
      <Field label="Work email" name="email" type="email" autoComplete="email" required />
      <Field label="Center address" name="address" autoComplete="street-address" required />
      <Field label="Center phone" name="phone" type="tel" autoComplete="tel" required />
      <Field
        label="Create a password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      <RuleHint />
      <Field
        label="DailyLog registration code"
        name="registration_code"
        autoComplete="off"
        placeholder="DL-1234-5678-9ABC-DEF0"
        required
      />
      <p className="-mt-2 text-[11.5px] leading-normal text-faint">
        DailyLog issues this one-time code after approving your center. It only
        works with the administrator email it was issued for.
      </p>

      {state.error && <Notice tone="error">{state.error}</Notice>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create your center"}
      </Button>
    </form>
  );
}
