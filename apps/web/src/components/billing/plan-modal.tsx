"use client";

import { useActionState } from "react";
import { createPlanAction, type BillingActionState } from "@/lib/billing/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// New tuition plan — the rates invoices prefill from.
export function PlanModal({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<BillingActionState, FormData>(
    createPlanAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">New plan</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          A rate you bill on a cadence — invoices prefill from it.
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Plan added.</b>
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <Field label="Plan name" name="name" placeholder="Infant full-time" required />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Amount" name="amount" inputMode="decimal" placeholder="1280.00" required />
            <label className="flex flex-col gap-[7px]">
              <span className="text-[13px] font-bold text-ink">Cadence</span>
              <select
                name="cadence"
                defaultValue="monthly"
                className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[15px] text-ink outline-none focus:border-primary"
              >
                <option value="monthly">Monthly</option>
                <option value="biweekly">Biweekly</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
          </div>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Adding…" : "Add plan"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
