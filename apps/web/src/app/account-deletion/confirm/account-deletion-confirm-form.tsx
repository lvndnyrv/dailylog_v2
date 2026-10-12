"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";

import {
  submitAccountDeletionAction,
  type AccountDeletionState,
} from "@/lib/account-deletion/actions";

const initialState: AccountDeletionState = {};

export function AccountDeletionConfirmForm() {
  const [state, action, pending] = useActionState(submitAccountDeletionAction, initialState);

  if (state.requested) {
    return (
      <div className="rounded-[18px] bg-success-bg p-5">
        <CheckCircle2 className="text-success" size={29} aria-hidden="true" />
        <h2 className="mt-3 text-lg font-black text-ink">Request received</h2>
        <p className="mt-2 text-sm leading-6 text-body">
          Your account remains available during review. DailyLog has notified the appropriate
          center administrators, and the request is retained in the audit trail.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="flex items-start gap-3 rounded-[16px] border border-hairline bg-canvas p-4 text-sm leading-6 text-body">
        <input name="confirm" value="yes" type="checkbox" required className="mt-1 size-4 accent-[var(--primary)]" />
        <span>I want DailyLog and my childcare center to review this account for deletion and understand that required records may be retained.</span>
      </label>
      {state.error && <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm font-semibold text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-12 w-full rounded-btn bg-danger px-5 text-sm font-extrabold text-white transition disabled:cursor-wait disabled:opacity-60">
        {pending ? "Submitting request…" : "Submit deletion request"}
      </button>
    </form>
  );
}
