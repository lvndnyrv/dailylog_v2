import type { FamilyLedgerEntry, FamilyPaymentReviewRow, InvoiceRow } from "@dailylog/db/queries";
import type { Tables } from "@dailylog/db";
import type { InvoiceTimingRow } from "./annual-invoice-timing";

type LineReview = Pick<Tables<"billing_annual_line_reviews">,
  "invoice_line_id" | "classification" | "note" | "reviewed_line_description"
  | "reviewed_line_amount_cents" | "service_start_on" | "service_end_on"
  | "service_evidence_note" | "reviewed_at">;
type Allocation = Pick<Tables<"billing_annual_payment_allocations">,
  "payment_id" | "event_kind" | "invoice_line_id" | "amount_cents" | "allocated_at">;
type AdjustmentReview = Pick<Tables<"billing_annual_adjustment_reviews">,
  "ledger_entry_id" | "disposition" | "invoice_line_id" | "note"
  | "reviewed_entry_amount_cents" | "reviewed_entry_description" | "reviewed_entry_effective_at"
  | "reviewed_line_description" | "reviewed_line_amount_cents" | "reviewed_at">;
type TimingReview = Pick<Tables<"billing_annual_invoice_timing_reviews">,
  "invoice_id" | "disposition" | "note" | "reviewed_issued_on" | "reviewed_invoice_status"
  | "reviewed_invoice_total_cents" | "reviewed_billed_cents" | "reviewed_received_cents"
  | "reviewed_refunded_cents" | "reviewed_at">;

export interface AnnualReviewExportInput {
  year: number;
  centerId: string;
  centerName: string;
  familyId: string;
  familyName: string;
  generatedAt: string;
  timeZone: string;
  invoices: InvoiceRow[];
  payments: FamilyPaymentReviewRow[];
  ledger: FamilyLedgerEntry[];
  lineReviews: LineReview[];
  allocations: Allocation[];
  adjustmentReviews: AdjustmentReview[];
  timingReviews: TimingReview[];
  timingRows: InvoiceTimingRow[];
  eventYear: (value: string | null) => number | null;
}

/** Internal source-and-decision handoff, deliberately without an eligible/tax total. */
export function annualReviewExportRows(input: AnnualReviewExportInput): unknown[][] {
  const rows: unknown[][] = [
    ["DailyLog private annual reconciliation evidence"],
    ["NOT A TAX STATEMENT. NOT APPROVED. NOT FOR FAMILIES."],
    ["Center", input.centerName, "Center ID", input.centerId],
    ["Family", input.familyName, "Family ID", input.familyId],
    ["Family", input.familyName, "Review year", input.year, "Generated at UTC", input.generatedAt,
      "Center time zone", input.timeZone],
    [],
    ["Record type", "Child", "Invoice", "Source ID", "Date", "Description", "Currency",
      "Amount cents", "Decision", "Review state", "Note / source evidence", "Care start", "Care end", "Reviewed at UTC", "Child ID"],
  ];
  const add = (kind: string, child: string, invoice: string, id: string, date: string | null,
    description: string, currency: string, amount: number | string, decision = "",
    state = "", note = "", careStart = "", careEnd = "", reviewedAt = "", childId = "") => {
    rows.push([kind, child, invoice, id, date ?? "", description, currency,
      amount, decision, state, note, careStart, careEnd, reviewedAt, childId]);
  };
  const invoicesById = new Map(input.invoices.map((invoice) => [invoice.id, invoice]));
  const lineById = new Map(input.invoices.flatMap((invoice) => invoice.lines.map((line) => [line.id, line] as const)));
  const paymentById = new Map(input.payments.map((payment) => [payment.id, payment]));
  const lineReviewById = new Map(input.lineReviews.map((review) => [review.invoice_line_id, review]));
  const adjustmentById = new Map(input.adjustmentReviews.map((review) => [review.ledger_entry_id, review]));
  const timingById = new Map(input.timingReviews.map((review) => [review.invoice_id, review]));
  const includedInvoiceIds = new Set(input.payments.filter((payment) =>
    input.eventYear(payment.paid_at) === input.year
    || (payment.status === "refunded" && input.eventYear(payment.refunded_at) === input.year))
    .map((payment) => payment.invoice?.id).filter((id): id is string => Boolean(id)));

  for (const invoice of input.invoices) {
    if (invoice.issued_on?.slice(0, 4) !== String(input.year) && !includedInvoiceIds.has(invoice.id)) continue;
    const child = invoice.child ? `${invoice.child.first_name} ${invoice.child.last_name}` : "Unassigned";
    add("invoice", child, invoice.number ?? "", invoice.id, invoice.issued_on,
      invoice.status, invoice.currency, invoice.total_cents, "", "", "", "", "", "", invoice.child?.id ?? "");
    for (const line of invoice.lines) {
      const review = lineReviewById.get(line.id);
      const stale = Boolean(review && (review.reviewed_line_description !== line.description
        || review.reviewed_line_amount_cents !== line.amount_cents));
      add("invoice line", child, invoice.number ?? "", line.id, invoice.issued_on,
        line.description, invoice.currency, line.amount_cents,
        review?.classification ?? "needs_review", !review ? "unreviewed" : stale ? "stale" : "recorded",
        [review?.note, review?.service_evidence_note].filter(Boolean).join(" | "),
        review?.service_start_on ?? "", review?.service_end_on ?? "", review?.reviewed_at ?? "",
        invoice.child?.id ?? "");
    }
  }

  for (const payment of input.payments) {
    const invoice = payment.invoice && invoicesById.get(payment.invoice.id);
    const paymentChild = invoice?.child ?? payment.invoice?.child;
    const child = paymentChild ? `${paymentChild.first_name} ${paymentChild.last_name}` : "Unassigned";
    const childId = paymentChild?.id ?? "";
    if (input.eventYear(payment.paid_at) === input.year) {
      add("receipt", child, invoice?.number ?? payment.invoice?.number ?? "", payment.id,
        payment.paid_at, payment.status, payment.currency, payment.amount_cents,
        "", "", "", "", "", "", childId);
    }
    if (!payment.paid_at) {
      add("receipt with missing date", child, invoice?.number ?? payment.invoice?.number ?? "", payment.id,
        null, payment.status, payment.currency, payment.amount_cents, "", "date missing; year unknown",
        "", "", "", "", childId);
    }
    if (payment.status === "refunded" && input.eventYear(payment.refunded_at) === input.year) {
      add("refund", child, invoice?.number ?? payment.invoice?.number ?? "", payment.id,
        payment.refunded_at, payment.status, payment.currency, -payment.amount_cents,
        "", "", "", "", "", "", childId);
    }
    if (payment.status === "refunded" && !payment.refunded_at) {
      add("refund with missing date", child, invoice?.number ?? payment.invoice?.number ?? "", payment.id,
        null, payment.status, payment.currency, -payment.amount_cents, "", "date missing; year unknown",
        "", "", "", "", childId);
    }
  }
  for (const allocation of input.allocations) {
    const line = lineById.get(allocation.invoice_line_id);
    const payment = paymentById.get(allocation.payment_id);
    const invoice = payment?.invoice && invoicesById.get(payment.invoice.id);
    const paymentChild = invoice?.child ?? payment?.invoice?.child;
    const child = paymentChild ? `${paymentChild.first_name} ${paymentChild.last_name}` : "Unassigned";
    add("allocation", child, invoice?.number ?? "", allocation.payment_id,
      allocation.event_kind === "refunded" ? payment?.refunded_at ?? null : payment?.paid_at ?? null,
      line?.description ?? `Line ${allocation.invoice_line_id}`, invoice?.currency ?? payment?.currency ?? "",
      allocation.event_kind === "refunded" ? -allocation.amount_cents : allocation.amount_cents,
      lineReviewById.get(allocation.invoice_line_id)?.classification ?? "needs_review",
      !payment ? "source payment missing" : !line ? "source line missing" : "recorded",
      "", "", "", allocation.allocated_at, paymentChild?.id ?? "");
  }
  for (const entry of input.ledger) {
    if (!["credit", "adjustment", "writeoff"].includes(entry.entry_type)
      || input.eventYear(entry.effective_at) !== input.year) continue;
    const review = adjustmentById.get(entry.id);
    const reviewedLine = review?.invoice_line_id ? lineById.get(review.invoice_line_id) : null;
    const stale = Boolean(review && (review.reviewed_entry_amount_cents !== entry.amount_cents
      || review.reviewed_entry_description !== entry.description
      || review.reviewed_entry_effective_at !== entry.effective_at
      || (review.invoice_line_id && (!reviewedLine
        || review.reviewed_line_description !== reviewedLine.description
        || review.reviewed_line_amount_cents !== reviewedLine.amount_cents))));
    add("household adjustment", "Unassigned", "", entry.id, entry.effective_at,
      entry.description, entry.currency, entry.amount_cents,
      review?.disposition ?? "needs_review", !review ? "unreviewed" : stale ? "stale" : "recorded",
      [review?.note, review?.invoice_line_id ? `Possible line ${review.invoice_line_id}` : ""].filter(Boolean).join(" | "),
      "", "", review?.reviewed_at ?? "");
  }
  for (const timing of input.timingRows) {
    if (timing.billedCents === timing.receivedCents - timing.refundedCents) continue;
    const invoice = invoicesById.get(timing.invoiceId);
    const review = timingById.get(timing.invoiceId);
    const stale = Boolean(review && invoice && (
      review.reviewed_issued_on !== invoice.issued_on
      || review.reviewed_invoice_status !== invoice.status
      || review.reviewed_invoice_total_cents !== invoice.total_cents
      || review.reviewed_billed_cents !== timing.billedCents
      || review.reviewed_received_cents !== timing.receivedCents
      || review.reviewed_refunded_cents !== timing.refundedCents));
    add("invoice/payment difference", timing.childName, timing.invoiceNumber, timing.invoiceId,
      timing.issuedOn, timing.note, "CAD", timing.billedCents - timing.receivedCents + timing.refundedCents,
      review?.disposition ?? "accounting_followup", !review ? "unreviewed" : stale ? "stale" : "recorded",
      review?.note ?? "", "", "", review?.reviewed_at ?? "", timing.childId ?? "");
  }
  return rows;
}
