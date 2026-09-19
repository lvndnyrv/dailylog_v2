"use client";

import { useActionState } from "react";
import { magicLinkAction, signInAction, type ActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function SignInForm({
  resetDone,
  destination,
}: {
  resetDone: boolean;
  destination: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    signInAction,
    {},
  );
  const [linkState, linkAction, linkPending] = useActionState<ActionState, FormData>(
    magicLinkAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <input type="hidden" name="next" value={destination} />
      {resetDone && (
        <Notice tone="success">
          <b>Password updated.</b> Sign in with your new password.
        </Notice>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}

      <Field label="Work email" name="email" type="email" autoComplete="email" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />

      <div className="flex items-center gap-2.5">
        <label className="flex items-center gap-2 text-[13px] text-body">
          <input
            type="checkbox"
            name="remember"
            defaultChecked
            className="size-[17px] rounded-md accent-[var(--primary)]"
          />
          Keep me signed in on this device
        </label>
        <span className="flex-1" />
        <a href="/forgot" className="text-[13px] font-bold text-primary hover:text-primary-hover">
          Forgot password?
        </a>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-[1.5px] flex-1 bg-[#EDF3FB]" />
        <span className="text-xs text-faint">or</span>
        <span className="h-[1.5px] flex-1 bg-[#EDF3FB]" />
      </div>

      {linkState.sent ? (
        <Notice tone="success">
          <b>Link sent.</b> Check your inbox — it signs you in directly.
        </Notice>
      ) : (
        <Button
          variant="secondary"
          formAction={linkAction}
          formNoValidate
          disabled={linkPending}
          className="py-3.5 text-sm"
        >
          {linkPending ? "Sending…" : "Email me a one-time sign-in link"}
        </Button>
      )}
      {linkState.error && <Notice tone="error">{linkState.error}</Notice>}
    </form>
  );
}
