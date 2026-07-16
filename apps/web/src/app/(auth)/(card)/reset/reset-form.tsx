"use client";

import { useActionState } from "react";
import { resetPasswordAction, type ActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { RuleHint } from "@/components/ui/rule-hint";

export function ResetForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    resetPasswordAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      <RuleHint />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save & sign in"}
      </Button>
    </form>
  );
}
