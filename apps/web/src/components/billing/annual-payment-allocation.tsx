"use client";

import { useActionState, useState } from "react";
import {
  saveAnnualAllocationAction,
  type AnnualAllocationState,
} from "@/lib/billing/annual-allocation-actions";

export interface AnnualPaymentEvent {
  paymentId: string;
  childId: string;
  kind: "received" | "refunded";
  amountCents: number;
  invoiceNumber: string;
  childName: string;
  eventDate: string;
  linesMatchTotal: boolean;
  allReviewed: boolean;
  originalReceiptAllocated: boolean;
  lines: {
    id: string;
    description: string;
    classification: string;
    amountCents: number;
    allocatedCents: number;
  }[];
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseCents(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function EventForm({ familyId, event }: { familyId: string; event: AnnualPaymentEvent }) {
  const [state, action, pending] = useActionState<AnnualAllocationState, FormData>(
    saveAnnualAllocationAction, {},
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(event.lines.map((line) => [line.id, dollars(line.allocatedCents)])),
  );
  const [localError, setLocalError] = useState("");
  const allocatedCents = event.lines.reduce((sum, line) => sum + line.allocatedCents, 0);
  const lockedReason = !event.linesMatchTotal
    ? "Invoice lines do not match the invoice total. Resolve that difference first."
    : !event.allReviewed
      ? "Classify every current invoice line above before allocating this event."
      : event.kind === "refunded" && !event.originalReceiptAllocated
        ? "Allocate this payment’s original receipt before allocating its refund."
        : null;

  return <form action={action} onSubmit={(submitEvent) => {
    const parsed = event.lines.map((line) => parseCents(amounts[line.id] ?? "0"));
    if (parsed.some((value) => value === null)) {
      submitEvent.preventDefault();
      setLocalError("Use dollars and cents, with no more than two decimal places.");
    } else if (parsed.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== event.amountCents) {
      submitEvent.preventDefault();
      setLocalError(`Amounts must add up exactly to ${money(event.amountCents)}.`);
    }
  }} className="rounded-xl border border-[#D6E1F0] bg-white p-4">
    <input type="hidden" name="family_id" value={familyId} />
    <input type="hidden" name="payment_id" value={event.paymentId} />
    <input type="hidden" name="event_kind" value={event.kind} />
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-[13px] font-bold text-ink">{event.childName} · {event.kind === "received" ? "Payment received" : "Refund"}</h3>
        <p className="mt-0.5 text-[11px] text-muted">{event.invoiceNumber} · {event.eventDate}</p>
      </div>
      <div className="text-right">
        <strong className="block text-[13px] text-ink">{money(event.amountCents)}</strong>
        <span className="text-[11px] text-muted">{lockedReason && allocatedCents === event.amountCents
          ? "Allocation needs recheck"
          : allocatedCents === event.amountCents ? "Internally allocated" : "Not allocated"}</span>
      </div>
    </div>
    <div className="mt-3 grid gap-2">
      {event.lines.map((line) => <label key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F8FBFE] px-3 py-2 text-[12px]">
        <input type="hidden" name="line_id" value={line.id} />
        <span className="min-w-0 flex-1 text-ink">
          <span className="block font-semibold">{line.description}</span>
          <span className="text-[11px] text-muted">Line {money(line.amountCents)} · {line.classification === "care_service_candidate" ? "Care-service candidate" : line.classification === "exclude" ? "Excluded from draft" : "Needs review"}</span>
        </span>
        <span className="flex items-center gap-1 font-semibold text-muted">$
          <input name={`amount_${line.id}`} aria-label={`Allocate dollars to ${line.description}`}
            inputMode="decimal" value={amounts[line.id] ?? "0.00"} disabled={Boolean(lockedReason) || pending}
            onChange={(changeEvent) => {
              setAmounts((current) => ({ ...current, [line.id]: changeEvent.target.value }));
              setLocalError("");
            }}
            className="w-28 rounded-lg border border-[#D6E1F0] bg-white px-2 py-1.5 text-right text-ink disabled:opacity-60" />
        </span>
      </label>)}
    </div>
    {lockedReason && <p className="mt-3 text-[11px] font-semibold text-amber-700">{lockedReason}</p>}
    {(localError || state.error) && <p role="alert" className="mt-3 text-[11px] font-semibold text-red-700">{localError || state.error}</p>}
    {state.ok && <p role="status" className="mt-3 text-[11px] font-semibold text-success">Allocation saved internally. No statement was generated.</p>}
    <div className="mt-3 flex items-center justify-between gap-3">
      <p className="text-[11px] text-muted">Enter the full {event.kind === "received" ? "payment" : "refund"} across its invoice lines.</p>
      <button type="submit" disabled={Boolean(lockedReason) || pending}
        className="shrink-0 rounded-lg bg-primary px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save allocation"}
      </button>
    </div>
  </form>;
}

export function AnnualPaymentAllocation({ familyId, year, events }: {
  familyId: string;
  year: number;
  events: AnnualPaymentEvent[];
}) {
  const unallocatedCount = events.filter((event) => !event.linesMatchTotal || !event.allReviewed
    || event.lines.reduce((sum, line) => sum + line.allocatedCents, 0) !== event.amountCents).length;
  return <section id="payment-allocation" className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card">
    <div className="border-b border-[#EDF3FB] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-extrabold text-ink">Payment allocation · {year}</h2>
        <span className="rounded-full bg-warning-bg px-2.5 py-1 text-[11px] font-bold text-warning-text">
          {unallocatedCount} of {events.length} events need allocation or recheck
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted">Reconcile each received payment and refund against its invoice lines. Even complete allocations are internal evidence—not a tax-eligible total, receipt, or publication approval.</p>
    </div>
    <div className="grid gap-3 p-4 md:p-5">
      {events.map((event) => <EventForm
        key={`${event.paymentId}:${event.kind}:${event.lines.map((line) => line.allocatedCents).join(",")}`}
        familyId={familyId} event={event} />)}
      {events.length === 0 && <p className="py-5 text-center text-[12px] text-muted">No child-linked CAD payment or refund events recorded for this year.</p>}
    </div>
  </section>;
}
