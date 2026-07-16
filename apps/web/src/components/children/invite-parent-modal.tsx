"use client";

import { useActionState } from "react";
import { inviteParentAction, type ChildActionState } from "@/lib/children/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Invite/link a parent (19a "Family & contacts"). Creates a single-use code the
// parent enters in the DailyLog app (mobile 16d). Email delivery is a later
// phase — the code is shown here to pass along (DECISIONS.md).
export function InviteParentModal({
  childId,
  childName,
  onClose,
}: {
  childId: string;
  childName: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    inviteParentAction,
    {},
  );

  return (
    <Modal onClose={onClose}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Invite a parent</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          They download the DailyLog app, create an account with this email, and
          enter the code to link to {childName}.
        </p>
      </div>

      {state.ok && state.inviteCode ? (
        <>
          <div className="flex flex-col items-center gap-1 rounded-[13px] bg-canvas px-4 py-5">
            <span className="text-[11.5px] font-semibold text-muted">Invite code — works once, 14 days</span>
            <span className="font-mono text-[26px] font-semibold tracking-[.18em] text-ink">
              {state.inviteCode}
            </span>
          </div>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="child_id" value={childId} />
          <Field label="Parent email" name="email" type="email" required />
          <Field label="Relation (optional)" name="relationship" placeholder="Mother" />

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Creating…" : "Create invite"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
