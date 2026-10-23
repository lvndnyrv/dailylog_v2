export interface ReconciliationIssue {
  id: string;
  title: string;
  detail: string;
  count: number;
  href: string;
}

export interface ReconciliationInput {
  providerDetailsRecorded: boolean;
  reviewYear: number;
  eventCount: number;
  unassignedPaymentCount: number;
  missingPaymentDates: number;
  missingRefundDates: number;
  nonCadPaymentCount: number;
  unreviewableChildEvents: number;
  nonCadManualCount: number;
  unresolvedTimingCount: number;
  lines: {
    classification: string;
    stale: boolean;
    serviceStartOn: string;
    serviceEndOn: string;
    serviceEvidenceNote: string;
  }[];
  events: {
    amountCents: number;
    linesMatchTotal: boolean;
    allReviewed: boolean;
    originalReceiptAllocated: boolean;
    kind: "received" | "refunded";
    lines: { allocatedCents: number }[];
  }[];
  adjustments: { disposition: string; stale: boolean }[];
}

export function annualReconciliationIssues(input: ReconciliationInput): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  const add = (id: string, title: string, detail: string, count: number, href: string) => {
    if (count > 0) issues.push({ id, title, detail, count, href });
  };

  add("provider", "Provider identity incomplete",
    "Record the legal name, statement address and signer. Recording them is not approval.",
    input.providerDetailsRecorded ? 0 : 1, "/settings");
  add("no-activity", "No reviewable payment activity",
    "There are no child-linked CAD payment or refund events to reconcile for this year.",
    input.eventCount === 0 ? 1 : 0, "#year-end-review");
  add("unassigned", "Payments without a child-linked invoice",
    "These records cannot be placed on a child's statement automatically.",
    input.unassignedPaymentCount, "#year-end-review");
  add("undated", "Payment or refund dates missing",
    "An undated record could belong to any year. Resolve it in the source record first.",
    input.missingPaymentDates + input.missingRefundDates, "#year-end-review");
  add("currency", "Non-CAD records need separate review",
    "These payment or manual-entry records are excluded from the CAD review.",
    input.nonCadPaymentCount + input.nonCadManualCount, "#year-end-review");
  add("unreviewable", "Child payment events lack an active invoice",
    "A void or unavailable invoice prevents line review and allocation.",
    input.unreviewableChildEvents, "#year-end-review");
  add("timing", "Invoice/payment differences need explanation",
    "Record why billed and net paid figures differ, or leave the invoice for accounting follow-up. A note is not statement approval.",
    input.unresolvedTimingCount, "#invoice-timing-review");

  const linesNeedingReview = input.lines.filter((line) => line.stale
    || line.classification === "needs_review").length;
  add("lines", "Invoice lines need classification",
    "Review the current line description and amount before using its allocation.",
    linesNeedingReview, "#invoice-line-review");
  const candidates = input.lines.filter((line) => !line.stale
    && line.classification === "care_service_candidate");
  add("no-candidates", "No care-service candidates recorded",
    "A statement cannot be drafted from unclassified or wholly excluded lines.",
    input.eventCount > 0 && linesNeedingReview === 0 && candidates.length === 0 ? 1 : 0,
    "#invoice-line-review");
  add("care-evidence", "Care dates or their source are missing",
    "Record when the care was provided and the source of those dates.",
    candidates.filter((line) => !line.serviceStartOn || !line.serviceEndOn
      || line.serviceEvidenceNote.trim().length < 8).length,
    "#invoice-line-review");
  add("cross-year", "Care dates differ from the payment year",
    "These periods need an explicit accounting/tax review; payment date alone is insufficient.",
    candidates.filter((line) => line.serviceStartOn && line.serviceEndOn
      && (line.serviceStartOn.slice(0, 4) !== String(input.reviewYear)
        || line.serviceEndOn.slice(0, 4) !== String(input.reviewYear))).length,
    "#invoice-line-review");

  add("invoice-totals", "Invoice lines do not match invoice totals",
    "Fix the underlying invoice before assigning payment events to its lines.",
    input.events.filter((event) => !event.linesMatchTotal).length,
    "#payment-allocation");
  add("allocations", "Payment or refund events need allocation",
    "The full event must be assigned to current lines; refunds must match their original receipt allocation.",
    input.events.filter((event) => !event.allReviewed
      || (event.kind === "refunded" && !event.originalReceiptAllocated)
      || event.lines.reduce((sum, line) => sum + line.allocatedCents, 0) !== event.amountCents).length,
    "#payment-allocation");
  add("adjustments", "Household adjustments need accounting resolution",
    "A possible invoice relationship is only a review note, not an applied credit.",
    input.adjustments.filter((item) => item.stale || item.disposition !== "not_child_care").length,
    "#adjustment-review");
  return issues;
}
