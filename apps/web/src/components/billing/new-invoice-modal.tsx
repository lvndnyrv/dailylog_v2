"use client";

import type { BillingPlan } from "@dailylog/db/queries";
import { useActionState, useState } from "react";
import { createInvoiceAction, type BillingActionState } from "@/lib/billing/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import type { ChildOption } from "./billing-view";

interface Line {
  description: string;
  amount: string;
}

// New invoice (6a "+ New invoice") — pick the child, prefill from a plan,
// adjust lines, set the due date.
export function NewInvoiceModal({
  childrenRows,
  plans,
  onClose,
}: {
  childrenRows: ChildOption[];
  plans: BillingPlan[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<BillingActionState, FormData>(
    createInvoiceAction,
    {},
  );
  const [childId, setChildId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", amount: "" }]);

  const child = childrenRows.find((c) => c.id === childId);
  const [due] = useState(() => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));

  return (
    <Modal onClose={onClose} width={560}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">New invoice</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Numbered automatically. The family sees it once parent billing ships —
          for now it&apos;s your record.
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Invoice created.</b>
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="billed_to" value={child?.guardianId ?? ""} />

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-[7px]">
              <span className="text-[13px] font-bold text-ink">Child</span>
              <select
                name="child_id"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                required
                className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
              >
                <option value="" disabled>
                  Pick a child
                </option>
                {childrenRows.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Due date" name="due_on" type="date" defaultValue={due} required />
          </div>

          {child && (
            <div className="flex items-center gap-3 rounded-[11px] bg-canvas px-3 py-2 text-[12px] text-muted">
              <span className="min-w-0 flex-1">Billed to <b className="text-ink">{child.guardianName ?? "no linked parent"}</b></span>
              {child.tuitionRate && (
                <button type="button" className="font-bold text-primary hover:underline" onClick={() => setLines([{
                  description: `${new Date().toLocaleDateString("en-CA", { month: "long" })} tuition — ${child.tuitionRate!.roomName}`,
                  amount: (child.tuitionRate!.amountCents / 100).toFixed(2),
                }])}>
                  Use current rate · {(child.tuitionRate.amountCents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}
                </button>
              )}
            </div>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="flex w-full items-center text-[13px] font-bold text-ink">
              Lines
              <select
                aria-label="Prefill from plan"
                className="ml-auto rounded-[10px] border-[1.5px] border-[#D6E1F0] bg-card px-2 py-1.5 text-[11.5px] font-semibold text-primary outline-none"
                value=""
                onChange={(e) => {
                  const plan = plans.find((p) => p.id === e.target.value);
                  if (plan) {
                    setLines((rows) => [
                      ...rows.filter((row) => row.description || row.amount),
                      {
                        description: `${new Date().toLocaleDateString("en-CA", { month: "long" })} tuition — ${plan.name}`,
                        amount: (plan.amount_cents / 100).toFixed(2),
                      },
                    ]);
                  }
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  + from plan
                </option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </legend>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[2fr_.8fr_24px] items-center gap-1.5">
                <input
                  name="line_description"
                  value={line.description}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((row, j) => (j === i ? { ...row, description: e.target.value } : row)),
                    )
                  }
                  placeholder="July tuition — Infant full-time"
                  aria-label={`Line ${i + 1} description`}
                  className="rounded-[10px] border-[1.5px] border-[#D6E1F0] bg-card px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-primary"
                />
                <input
                  name="line_amount"
                  value={line.amount}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((row, j) => (j === i ? { ...row, amount: e.target.value } : row)),
                    )
                  }
                  placeholder="780.00"
                  inputMode="decimal"
                  aria-label={`Line ${i + 1} amount`}
                  className="rounded-[10px] border-[1.5px] border-[#D6E1F0] bg-card px-2.5 py-2 text-right font-mono text-[12.5px] text-ink outline-none focus:border-primary"
                />
                <button
                  type="button"
                  aria-label="Remove line"
                  onClick={() => setLines((rows) => rows.filter((_, j) => j !== i))}
                  className="text-faint hover:text-danger"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLines((rows) => [...rows, { description: "", amount: "" }])}
              className="self-start text-[12.5px] font-bold text-primary hover:text-primary-hover"
            >
              + Add line
            </button>
          </fieldset>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Creating…" : "Create invoice"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
