"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";

import {
  requestAccountDeletionLinkAction,
  type AccountDeletionState,
} from "@/lib/account-deletion/actions";

const initialState: AccountDeletionState = {};

export function AccountDeletionForm() {
  const [state, action, pending] = useActionState(requestAccountDeletionLinkAction, initialState);

  if (state.sent) {
    return (
      <div className="rounded-[18px] bg-tint p-5">
        <MailCheck className="text-primary" aria-hidden="true" size={27} />
        <h2 className="mt-3 text-lg font-black text-ink">Check your email</h2>
        <p className="mt-2 text-sm leading-6 text-body">
          If the address belongs to a DailyLog account, we sent a secure verification link.
          The link opens the final request step; it does not delete anything immediately.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">
        <span className="mb-2 block text-sm font-extrabold text-ink">Account email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="h-12 w-full rounded-[14px] border border-hairline bg-white px-4 text-[15px] text-ink outline-none transition placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </label>
      {state.error && <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm font-semibold text-danger">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-btn bg-primary px-5 text-sm font-extrabold text-white transition hover:bg-primary-hover disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Sending secure link…" : "Verify my account"}
      </button>
    </form>
  );
}
