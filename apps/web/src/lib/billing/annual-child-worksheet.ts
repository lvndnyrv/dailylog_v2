export interface ChildPaymentRow {
  id: string;
  name: string;
  received: number;
  refunded: number;
}

export interface ChildReviewLine {
  id: string;
  classification: string;
  stale: boolean;
  serviceStartOn: string;
  serviceEndOn: string;
  serviceEvidenceNote: string;
}

export interface ChildReviewEvent {
  childId: string;
  kind: "received" | "refunded";
  amountCents: number;
  linesMatchTotal: boolean;
  allReviewed: boolean;
  originalReceiptAllocated: boolean;
  lines: { id: string; allocatedCents: number }[];
}

export interface AnnualChildWorksheet extends ChildPaymentRow {
  candidateCents: number | null;
  excludedCents: number | null;
  gaps: string[];
}

// Internal allocation worksheet only. This does not decide which expenses may be claimed.
export function annualChildWorksheets(
  year: number,
  rows: ChildPaymentRow[],
  lines: ChildReviewLine[],
  events: ChildReviewEvent[],
): AnnualChildWorksheet[] {
  const byLine = new Map(lines.map((line) => [line.id, line]));
  return rows.map((row) => {
    const childEvents = events.filter((event) => event.childId === row.id);
    const gaps: string[] = [];
    const received = childEvents.filter((event) => event.kind === "received")
      .reduce((sum, event) => sum + event.amountCents, 0);
    const refunded = childEvents.filter((event) => event.kind === "refunded")
      .reduce((sum, event) => sum + event.amountCents, 0);
    if (received !== row.received || refunded !== row.refunded || childEvents.length === 0) {
      gaps.push("Payment activity does not match reviewable invoice events");
    }
    if (childEvents.some((event) => !event.linesMatchTotal || !event.allReviewed
      || (event.kind === "refunded" && !event.originalReceiptAllocated)
      || event.lines.reduce((sum, line) => sum + line.allocatedCents, 0) !== event.amountCents)) {
      gaps.push("Invoice review or payment allocation is incomplete");
    }
    const usedLines = childEvents.flatMap((event) => event.lines.map((line) => byLine.get(line.id)));
    if (usedLines.some((line) => !line || line.stale || line.classification === "needs_review")) {
      gaps.push("An invoice-line decision is missing or stale");
    }
    const candidates = usedLines.filter((line) => line?.classification === "care_service_candidate");
    if (candidates.some((line) => !line?.serviceStartOn || !line.serviceEndOn
      || line.serviceEvidenceNote.trim().length < 8)) {
      gaps.push("Care dates or their source need review");
    }
    if (candidates.some((line) => line?.serviceStartOn.slice(0, 4) !== String(year)
      || line.serviceEndOn.slice(0, 4) !== String(year))) {
      gaps.push("Care period crosses the selected payment year");
    }
    if (gaps.length) return { ...row, candidateCents: null, excludedCents: null, gaps };

    let candidateCents = 0;
    let excludedCents = 0;
    for (const event of childEvents) {
      const sign = event.kind === "refunded" ? -1 : 1;
      for (const allocation of event.lines) {
        if (byLine.get(allocation.id)?.classification === "care_service_candidate") {
          candidateCents += sign * allocation.allocatedCents;
        } else {
          excludedCents += sign * allocation.allocatedCents;
        }
      }
    }
    return { ...row, candidateCents, excludedCents, gaps };
  });
}
