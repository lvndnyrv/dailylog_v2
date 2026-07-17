"use client";

import { useActionState } from "react";
import { addPickupAction, type ChildActionState } from "@/lib/children/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Add authorized pickup 19c. The PIN is generated server-side (unique per
// center — kiosk integrity) and revealed once the person is added.
export function PickupModal({
  childId,
  childName,
  onClose,
}: {
  childId: string;
  childName: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    addPickupAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={560}>
      <div className="flex items-start justify-between">
        <h2 className="text-[19px] font-extrabold text-ink">Add authorized pickup</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-faint hover:text-muted">
          ✕
        </button>
      </div>
      <p className="text-[12.5px] leading-normal text-muted">
        Added for <b className="text-ink">{childName}</b>. They can collect {childName} using
        the 4-digit PIN — educators verify it against the family pass in the app.
      </p>

      {state.ok && state.pin ? (
        <>
          <Notice tone="success">
            <b>Added.</b> Share the PIN with the family — it also appears on the
            pickups list.
          </Notice>
          <div className="flex items-center gap-3 rounded-[13px] bg-canvas px-4 py-3">
            <span className="flex-1">
              <span className="block text-[13px] font-bold text-ink">Pickup PIN</span>
              <span className="block text-[11.5px] text-muted">
                Unique to this family at your center
              </span>
            </span>
            <span className="font-mono text-[22px] font-semibold tracking-[.2em] text-ink">
              {state.pin}
            </span>
          </div>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="child_id" value={childId} />

          <Field label="Full name" name="full_name" placeholder="e.g. Rosa Torres" required />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Relation" name="relationship" placeholder="Grandmother" />
            <Field label="Phone" name="phone" placeholder="416-555-…" />
          </div>

          <p className="rounded-[13px] bg-canvas px-4 py-3 text-[12px] text-muted">
            The 4-digit PIN is generated when you add them — you&apos;ll see it on
            the next screen.
          </p>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Adding…" : "Add pickup"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
