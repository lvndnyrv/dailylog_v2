"use client";

import { useActionState } from "react";
import { acceptInviteAction, type ActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { RuleHint } from "@/components/ui/rule-hint";

export function InviteForm({ code, email }: { code: string; email: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    acceptInviteAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="email" value={email} />

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
        {pending ? "Setting up…" : "Accept & open the dashboard"}
      </Button>
    </form>
  );
}
