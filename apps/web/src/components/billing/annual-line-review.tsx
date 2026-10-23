"use client";

import { useActionState, useState } from "react";
import {
  saveAnnualLineReviewAction,
  type AnnualLineReviewState,
} from "@/lib/billing/annual-review-actions";

export interface AnnualReviewLine {
  id: string;
  childId: string;
  invoiceNumber: string;
  childName: string;
  description: string;
  amountCents: number;
  classification: string;
  note: string;
  stale: boolean;
  reviewedAt: string | null;
  serviceStartOn: string;
  serviceEndOn: string;
  serviceEvidenceNote: string;
}

function ReviewForm({ familyId, year, line }: {
  familyId: string;
  year: number;
  line: AnnualReviewLine;
}) {
  const [state, action, pending] = useActionState<AnnualLineReviewState, FormData>(
    saveAnnualLineReviewAction, {},
  );
  const [classification, setClassification] = useState(line.stale ? "needs_review" : line.classification);
  const [note, setNote] = useState(line.note);
  const [serviceStart, setServiceStart] = useState(line.serviceStartOn);
  const [serviceEnd, setServiceEnd] = useState(line.serviceEndOn);
  const [serviceEvidence, setServiceEvidence] = useState(line.serviceEvidenceNote);
  const [localError, setLocalError] = useState("");
  return <form action={action} onSubmit={(event) => {
    if (classification !== "needs_review" && note.trim().length < 5) {
      event.preventDefault();
      setLocalError("Add a reason of at least 5 characters before saving this decision.");
    } else if (Boolean(serviceStart) !== Boolean(serviceEnd) || (serviceStart && serviceStart > serviceEnd)) {
      event.preventDefault();
      setLocalError("Enter both care dates, in chronological order.");
    } else if (serviceStart && serviceEvidence.trim().length < 8) {
      event.preventDefault();
      setLocalError("Describe the source of the care dates in at least 8 characters.");
    }
  }} className="grid gap-2 rounded-xl border border-[#D6E1F0] bg-white p-3.5 md:grid-cols-[minmax(0,1fr)_200px]">
    <input type="hidden" name="family_id" value={familyId} />
    <input type="hidden" name="invoice_line_id" value={line.id} />
    <input type="hidden" name="review_year" value={year} />
    <div className="min-w-0">
      <p className="text-[12.5px] font-bold text-ink">{line.childName} · {line.description}</p>
      <p className="mt-0.5 text-[11px] text-muted">{line.invoiceNumber} · Invoice line {formatMoney(line.amountCents)} · not a paid or eligible amount</p>
      {line.stale && <p className="mt-1 text-[11px] font-semibold text-amber-700">This line changed after its last review. Re-check it and save a new decision.</p>}
      <label className="mt-2 block text-[11px] font-semibold text-muted" htmlFor={`review-note-${line.id}`}>Review reason</label>
      <input id={`review-note-${line.id}`} name="note" maxLength={500} value={note}
        onChange={(event) => { setNote(event.target.value); setLocalError(""); }}
        placeholder="Why is this line marked this way?" className="mt-1 w-full rounded-lg border border-[#D6E1F0] px-3 py-2 text-[12px] text-ink" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-semibold text-muted">Care from
          <input type="date" name="service_start_on" value={serviceStart}
            onChange={(event) => { setServiceStart(event.target.value); setLocalError(""); }}
            className="mt-1 block w-full rounded-lg border border-[#D6E1F0] px-3 py-2 text-[12px] text-ink" />
        </label>
        <label className="text-[11px] font-semibold text-muted">Care through
          <input type="date" name="service_end_on" value={serviceEnd}
            onChange={(event) => { setServiceEnd(event.target.value); setLocalError(""); }}
            className="mt-1 block w-full rounded-lg border border-[#D6E1F0] px-3 py-2 text-[12px] text-ink" />
        </label>
      </div>
      <label className="mt-2 block text-[11px] font-semibold text-muted" htmlFor={`service-evidence-${line.id}`}>Care-date evidence</label>
      <input id={`service-evidence-${line.id}`} name="service_evidence_note" maxLength={500}
        value={serviceEvidence} onChange={(event) => { setServiceEvidence(event.target.value); setLocalError(""); }}
        placeholder="For example, signed enrollment contract or attendance records"
        className="mt-1 w-full rounded-lg border border-[#D6E1F0] px-3 py-2 text-[12px] text-ink" />
      {classification === "care_service_candidate" && (!serviceStart || !serviceEnd || !serviceEvidence.trim())
        && <p className="mt-1 text-[11px] font-semibold text-amber-700">Care dates and their source still need review. This line is not ready for a statement.</p>}
      {(state.error || localError) && <p role="alert" className="mt-1 text-[11px] text-red-700">{localError || state.error}</p>}
      {state.ok && <p role="status" className="mt-1 text-[11px] text-success">Review saved. No statement was generated.</p>}
    </div>
    <div className="flex flex-col gap-2">
      <label className="text-[11px] font-semibold text-muted" htmlFor={`review-class-${line.id}`}>Internal classification</label>
      <select id={`review-class-${line.id}`} name="classification" value={classification}
        onChange={(event) => { setClassification(event.target.value); setLocalError(""); }}
        className="rounded-lg border border-[#D6E1F0] bg-white px-3 py-2 text-[12px] text-ink">
        <option value="needs_review">Needs review</option>
        <option value="care_service_candidate">Care-service candidate</option>
        <option value="exclude">Exclude from draft</option>
      </select>
      <button type="submit" disabled={pending} className="rounded-lg bg-primary px-3 py-2 text-[12px] font-bold text-white disabled:opacity-60">
        {pending ? "Saving…" : "Save review"}
      </button>
    </div>
  </form>;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

export function AnnualLineReview({ familyId, year, lines }: {
  familyId: string;
  year: number;
  lines: AnnualReviewLine[];
}) {
  const pendingCount = lines.filter((line) => line.stale || line.classification === "needs_review"
    || (line.classification === "care_service_candidate"
      && (!line.serviceStartOn || !line.serviceEndOn || !line.serviceEvidenceNote))).length;
  return <section id="invoice-line-review" className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card">
    <div className="border-b border-[#EDF3FB] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-extrabold text-ink">Invoice-line review · {year}</h2>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${pendingCount ? "bg-warning-bg text-warning-text" : "bg-[#F4F8FD] text-muted"}`}>
          {pendingCount ? `${pendingCount} of ${lines.length} need evidence or review` : `${lines.length} reviewed · not publishable`}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted">Classify each invoiced service and record the dates of care with their source. Payment year and care dates may differ. These reviews do not determine tax eligibility or approve publication.</p>
    </div>
    <div className="grid gap-3 p-4 md:p-5">
      {lines.map((line) => <ReviewForm key={`${line.id}:${line.reviewedAt ?? "new"}`} familyId={familyId} year={year} line={line} />)}
      {lines.length === 0 && <p className="py-5 text-center text-[12px] text-muted">No paid child-linked invoice lines to classify for this year.</p>}
    </div>
  </section>;
}
