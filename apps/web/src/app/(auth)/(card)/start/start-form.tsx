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
      <Field
        label="Create a password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      <RuleHint />

      {state.error && <Notice tone="error">{state.error}</Notice>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create your center"}
      </Button>
    </form>
  );
}
