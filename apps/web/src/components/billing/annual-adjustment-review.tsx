"use client";

import { useActionState, useState } from "react";
import {
  saveAnnualAdjustmentAction,
  type AnnualAdjustmentState,
} from "@/lib/billing/annual-adjustment-actions";

export interface AnnualAdjustmentLineOption {
  id: string;
  invoiceId: string;
  label: string;
  description: string;
  amountCents: number;
}

export interface AnnualAdjustmentItem {
  id: string;
  type: string;
  amountCents: number;
  description: string;
  date: string;
  sourceInvoiceId: string | null;
  disposition: string;
  invoiceLineId: string | null;
  note: string;
  reviewedAt: string | null;
  stale: boolean;
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function AdjustmentForm({ familyId, year, item, lines }: {
  familyId: string;
  year: number;
  item: AnnualAdjustmentItem;
  lines: AnnualAdjustmentLineOption[];
}) {
  const [state, action, pending] = useActionState<AnnualAdjustmentState, FormData>(
    saveAnnualAdjustmentAction, {},
  );
  const [disposition, setDisposition] = useState(item.stale ? "needs_review" : item.disposition);
  const [lineId, setLineId] = useState(item.invoiceLineId ?? "");
  const [note, setNote] = useState(item.note);
  const [localError, setLocalError] = useState("");
  const options = item.sourceInvoiceId
    ? lines.filter((line) => line.invoiceId === item.sourceInvoiceId)
    : lines;

  return <form action={action} onSubmit={(event) => {
    if (disposition === "possible_invoice_relation" && !lineId) {
      event.preventDefault();
      setLocalError("Choose the invoice line this entry may relate to.");
    } else if (disposition !== "needs_review" && note.trim().length < 8) {
      event.preventDefault();
      setLocalError("Add a review reason of at least 8 characters.");
    }
  }} className="rounded-xl border border-[#D6E1F0] bg-white p-4">
    <input type="hidden" name="family_id" value={familyId} />
    <input type="hidden" name="review_year" value={year} />
    <input type="hidden" name="ledger_entry_id" value={item.id} />
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <strong className="block text-[12.5px] text-ink">{item.description}</strong>
        <span className="text-[11px] capitalize text-muted">{item.type} · {item.date}{item.sourceInvoiceId ? " · invoice-linked" : " · household-level"}</span>
      </div>
      <strong className="text-[12px] text-amber-700">{item.amountCents < 0 ? "−" : "+"}{money(Math.abs(item.amountCents))}</strong>
    </div>
    {item.stale && <p className="mt-2 text-[11px] font-semibold text-amber-700">The entry or referenced invoice line changed. Re-check this review.</p>}
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-[11px] font-semibold text-muted">Internal disposition
        <select name="disposition" value={disposition}
          onChange={(event) => { setDisposition(event.target.value); setLocalError(""); }}
          className="mt-1 block w-full rounded-lg border border-[#D6E1F0] bg-white px-3 py-2 text-[12px] text-ink">
          <option value="needs_review">Needs review</option>
          <option value="possible_invoice_relation">Possibly related to an invoice line</option>
          <option value="not_child_care">Not related to child care</option>
          <option value="accounting_followup">Accounting follow-up needed</option>
        </select>
      </label>
      {disposition === "possible_invoice_relation" && <label className="text-[11px] font-semibold text-muted">Possible invoice line
        <select name="invoice_line_id" value={lineId}
          onChange={(event) => { setLineId(event.target.value); setLocalError(""); }}
          className="mt-1 block w-full rounded-lg border border-[#D6E1F0] bg-white px-3 py-2 text-[12px] text-ink">
          <option value="">Choose a line</option>
          {options.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}
        </select>
      </label>}
    </div>
    <label className="mt-3 block text-[11px] font-semibold text-muted">Review reason
      <input name="note" maxLength={500} value={note}
        onChange={(event) => { setNote(event.target.value); setLocalError(""); }}
        placeholder="Why does this entry have this disposition?"
        className="mt-1 block w-full rounded-lg border border-[#D6E1F0] px-3 py-2 text-[12px] text-ink" />
    </label>
    {(localError || state.error) && <p role="alert" className="mt-2 text-[11px] font-semibold text-red-700">{localError || state.error}</p>}
    {state.ok && <p role="status" className="mt-2 text-[11px] font-semibold text-success">Review saved. No balance or tax amount changed.</p>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] text-muted">A possible link is not a financial allocation or eligibility decision.</span>
      <button disabled={pending} className="rounded-lg bg-primary px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save review"}
      </button>
    </div>
  </form>;
}

export function AnnualAdjustmentReview({ familyId, year, items, lines, nonCadCount = 0 }: {
  familyId: string;
  year: number;
  items: AnnualAdjustmentItem[];
  lines: AnnualAdjustmentLineOption[];
  nonCadCount?: number;
}) {
  const pendingCount = items.filter((item) => item.stale || item.disposition === "needs_review").length;
  return <section id="adjustment-review" className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card">
    <div className="border-b border-[#EDF3FB] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-extrabold text-ink">Household adjustment review · {year}</h2>
        <span className="rounded-full bg-warning-bg px-2.5 py-1 text-[11px] font-bold text-warning-text">{pendingCount} of {items.length} need triage</span>
      </div>
      <p className="mt-1 text-[12px] text-muted">Credits, write-offs and manual adjustments are household-level ledger entries. Record a possible invoice relationship or why an entry needs follow-up. This does not apply a credit, allocate money to a child, or produce a tax amount.</p>
      {nonCadCount > 0 && <p className="mt-2 text-[11px] font-semibold text-amber-700">{nonCadCount} non-CAD manual entries also need separate currency review and are excluded here.</p>}
    </div>
    <div className="grid gap-3 p-4 md:p-5">
      {items.map((item) => <AdjustmentForm key={`${item.id}:${item.reviewedAt ?? "new"}`} familyId={familyId} year={year} item={item} lines={lines} />)}
      {items.length === 0 && <p className="py-3 text-center text-[12px] text-muted">No CAD manual credits, write-offs or adjustments recorded in this year. This does not establish that the account is fully reconciled.</p>}
    </div>
  </section>;
}
