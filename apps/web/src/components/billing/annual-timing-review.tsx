"use client";

import { useActionState, useState } from "react";
import { saveAnnualTimingAction, type AnnualTimingState } from "@/lib/billing/annual-timing-actions";

export interface TimingReviewItem {
  invoiceId: string;
  invoiceNumber: string;
  billedCents: number;
  receivedCents: number;
  refundedCents: number;
  disposition: string;
  note: string;
  reviewedAt: string | null;
  stale: boolean;
}

function TimingForm({ familyId, year, item }: {
  familyId: string;
  year: number;
  item: TimingReviewItem;
}) {
  const [state, action, pending] = useActionState<AnnualTimingState, FormData>(
    saveAnnualTimingAction, {},
  );
  const [disposition, setDisposition] = useState(item.stale ? "accounting_followup" : item.disposition);
  const [note, setNote] = useState(item.note);
  const [localError, setLocalError] = useState("");
  return <form action={action} onSubmit={(event) => {
    if (note.trim().length < 8) {
      event.preventDefault();
      setLocalError("Explain the difference in at least 8 characters.");
    }
  }} className="mt-2 grid gap-2 rounded-xl border border-[#D6E1F0] bg-[#F8FBFE] p-3 sm:grid-cols-[minmax(0,1fr)_190px]">
    <input type="hidden" name="family_id" value={familyId} />
    <input type="hidden" name="invoice_id" value={item.invoiceId} />
    <input type="hidden" name="review_year" value={year} />
    <label className="text-[11px] font-semibold text-muted">Internal explanation
      <input name="note" maxLength={500} value={note}
        onChange={(event) => { setNote(event.target.value); setLocalError(""); }}
        placeholder="For example, paid next January or outstanding balance confirmed"
        className="mt-1 block w-full rounded-lg border border-[#D6E1F0] bg-white px-3 py-2 text-[12px] text-ink" />
    </label>
    <div className="flex flex-col gap-2">
      <label className="text-[11px] font-semibold text-muted">Disposition
        <select name="disposition" value={disposition}
          onChange={(event) => { setDisposition(event.target.value); setLocalError(""); }}
          className="mt-1 block w-full rounded-lg border border-[#D6E1F0] bg-white px-3 py-2 text-[12px] text-ink">
          <option value="accounting_followup">Accounting follow-up</option>
          <option value="explained_timing">Payment-year timing explained</option>
          <option value="explained_open_balance">Open balance explained</option>
        </select>
      </label>
      <button disabled={pending} className="rounded-lg bg-primary px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save explanation"}
      </button>
    </div>
    {(localError || state.error) && <p role="alert" className="text-[11px] font-semibold text-red-700 sm:col-span-2">{localError || state.error}</p>}
    {state.ok && <p role="status" className="text-[11px] font-semibold text-success sm:col-span-2">Explanation saved. No ledger entry or statement changed.</p>}
  </form>;
}

export function AnnualTimingReview({ familyId, year, item }: {
  familyId: string;
  year: number;
  item: TimingReviewItem;
}) {
  return <div className="mt-2">
    <p className={`text-[11px] font-semibold ${item.stale || !item.reviewedAt ? "text-warning-text" : "text-muted"}`}>
      {item.stale ? "Financial activity changed since this explanation; review again."
        : item.reviewedAt ? `Internal disposition recorded: ${item.disposition.replaceAll("_", " ")}. This is not approval.`
          : "No explanation recorded for this difference."}
    </p>
    <TimingForm key={`${item.invoiceId}:${item.reviewedAt ?? "new"}`} familyId={familyId} year={year} item={item} />
  </div>;
}
