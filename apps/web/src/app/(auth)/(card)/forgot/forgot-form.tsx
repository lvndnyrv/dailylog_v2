"use client";

import { useActionState } from "react";
import { forgotAction, type ActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    forgotAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Work email" name="email" type="email" autoComplete="email" required />

      {state.sent && (
        <Notice tone="success">
          <b>Sent.</b> Check your inbox — the link works for 30 minutes.
        </Notice>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}

      {!state.sent && (
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Email me a reset link"}
        </Button>
      )}
      <a
        href="/sign-in"
        className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-center text-sm font-bold text-ink hover:bg-canvas"
      >
        Back to sign in
      </a>
    </form>
  );
}
