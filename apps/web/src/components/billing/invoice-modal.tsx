"use client";

import type { InvoiceRow } from "@dailylog/db/queries";
import { useActionState } from "react";
import { recordPaymentAction, type BillingActionState } from "@/lib/billing/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { dollars } from "./billing-view";

const label = "font-mono text-[10.5px] font-bold tracking-[.08em] text-faint";

// Invoice detail + record payment (the "Record" action on 6a rows).
export function InvoiceModal({
  invoice,
  overdue,
  onVoid,
  onClose,
}: {
  invoice: InvoiceRow;
  overdue: boolean;
  onVoid: (formData: FormData) => Promise<void>;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<BillingActionState, FormData>(
    recordPaymentAction,
    {},
  );

  const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  const remaining = Math.max(0, invoice.total_cents - paid);

  return (
    <Modal onClose={onClose} width={470}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-[17px] font-semibold text-ink">{invoice.number}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {invoice.family?.display_name ?? invoice.billed_to_profile?.full_name ?? "—"}
            {invoice.child ? ` · ${invoice.child.first_name} ${invoice.child.last_name}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-[3px] text-[11px] font-bold ${
            overdue
              ? "bg-danger-bg text-danger"
              : invoice.status === "paid"
                ? "bg-[#E4F3EC] text-success"
                : invoice.status === "void"
                  ? "bg-canvas text-faint"
                  : "bg-[#E7F0FB] text-primary"
          }`}
        >
          {overdue ? "Overdue" : invoice.status}
        </span>
      </div>

      <div>
        <span className={label}>LINES</span>
        <div className="mt-1 flex flex-col">
          {invoice.lines.map((line) => (
            <div key={line.id} className="flex items-baseline justify-between gap-3 border-b border-[#EDF3FB] py-2 last:border-b-0">
              <span className="text-[12.5px] text-body">{line.description}</span>
              <span className="whitespace-nowrap font-mono text-[12.5px] font-semibold text-ink">
                {dollars(line.amount_cents)}
              </span>
            </div>
          ))}
          <div className="flex items-baseline justify-between pt-2">
            <span className="text-[13px] font-extrabold text-ink">Total</span>
            <span className="font-mono text-[14px] font-bold text-ink">
              {dollars(invoice.total_cents)}
            </span>
          </div>
        </div>
      </div>

      {invoice.payments.length > 0 && (
        <div>
          <span className={label}>PAYMENTS</span>
          <div className="mt-1 flex flex-col gap-1">
            {invoice.payments.map((payment) => (
              <div key={payment.id} className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-muted">
                  {payment.paid_at
                    ? new Date(payment.paid_at).toLocaleDateString("en-CA", {
                        month: "short",
                        day: "numeric",
                      })
                    : "—"}{" "}
                  · {payment.method ?? "—"}
                </span>
                <span className="font-mono font-semibold text-success">
                  {dollars(payment.amount_cents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {invoice.reminders.length > 0 && (
        <div>
          <span className={label}>PAYMENT REMINDERS</span>
          <div className="mt-1 flex flex-col gap-1">
            {invoice.reminders
              .slice()
              .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
              .map((reminder) => (
                <div key={reminder.id} className="flex items-baseline justify-between text-[12.5px]">
                  <span className="text-muted">
                    {new Date(reminder.sent_at).toLocaleDateString("en-CA", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="font-semibold capitalize text-primary">
                    {reminder.tone} reminder · {reminder.status}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {invoice.status === "open" && (
        <form action={action} className="flex flex-col gap-3 rounded-[13px] bg-canvas p-3.5">
          <input type="hidden" name="invoice_id" value={invoice.id} />
          <span className="text-[13px] font-extrabold text-ink">
            Record a payment — {dollars(remaining)} remaining
          </span>
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Amount"
              name="amount"
              inputMode="decimal"
              defaultValue={(remaining / 100).toFixed(2)}
              required
            />
            <label className="flex flex-col gap-[7px]">
              <span className="text-[13px] font-bold text-ink">Method</span>
              <select
                name="method"
                defaultValue="etransfer"
                className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[15px] text-ink outline-none focus:border-primary"
              >
                <option value="etransfer">e-Transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="bank">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          {state.ok && (
            <Notice tone="success">
              <b>Recorded.</b>
            </Notice>
          )}
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <Button type="submit" className="py-3 text-sm" disabled={pending}>
            {pending ? "Recording…" : "Record payment"}
          </Button>
        </form>
      )}

      <div className="flex items-center gap-2.5">
        <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
          Close
        </Button>
        {invoice.status === "open" && (
          <form action={onVoid} className="flex-1">
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <button
              type="submit"
              className="w-full rounded-btn border-[1.5px] border-[#EFC9C9] px-4 py-3 text-sm font-bold text-danger hover:bg-danger-bg"
            >
              Void invoice
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
