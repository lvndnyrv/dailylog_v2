export interface TimingInvoice {
  id: string;
  number: string | null;
  status: string;
  issued_on: string | null;
  total_cents: number;
  currency: string;
  child: { id: string; first_name: string; last_name: string } | null;
}

export interface TimingPayment {
  amount_cents: number;
  currency: string;
  status: string;
  paid_at: string | null;
  refunded_at: string | null;
  invoice: { id: string } | null;
}

export interface InvoiceTimingRow {
  invoiceId: string;
  invoiceNumber: string;
  childId: string;
  childName: string;
  issuedOn: string | null;
  billedCents: number;
  receivedCents: number;
  refundedCents: number;
  note: string;
}

// Compares two accounting views; it does not decide which amount belongs on a tax document.
export function annualInvoiceTiming(
  year: number,
  invoices: TimingInvoice[],
  payments: TimingPayment[],
  eventYear: (value: string | null) => number | null,
): InvoiceTimingRow[] {
  return invoices.flatMap((invoice) => {
    if (!invoice.child || invoice.currency !== "CAD") return [];
    const issuedInYear = invoice.issued_on?.slice(0, 4) === String(year);
    const matching = payments.filter((payment) => payment.currency === "CAD"
      && (payment.status === "succeeded" || payment.status === "refunded")
      && payment.invoice?.id === invoice.id);
    const receivedCents = matching.filter((payment) => eventYear(payment.paid_at) === year)
      .reduce((sum, payment) => sum + payment.amount_cents, 0);
    const refundedCents = matching.filter((payment) => payment.status === "refunded"
      && eventYear(payment.refunded_at) === year)
      .reduce((sum, payment) => sum + payment.amount_cents, 0);
    if (!issuedInYear && receivedCents === 0 && refundedCents === 0) return [];
    const billedCents = issuedInYear && invoice.status !== "void" && invoice.status !== "draft"
      ? invoice.total_cents : 0;
    let note: string;
    if (invoice.status === "void" || invoice.status === "draft") note = "Inactive invoice; review any linked payment activity";
    else if (!invoice.issued_on) note = "Invoice date missing; payment year is known";
    else if (!issuedInYear) note = "Payment or refund this year for an invoice issued in another year";
    else if (receivedCents - refundedCents === billedCents) note = "Billed and net payment activity align in this year";
    else if (receivedCents - refundedCents === 0) note = "Billed this year; no net payment activity in this year";
    else note = "Billed and net payment activity differ; inspect payment and refund dates";
    return [{
      invoiceId: invoice.id,
      invoiceNumber: invoice.number ?? "Invoice",
      childId: invoice.child.id,
      childName: `${invoice.child.first_name} ${invoice.child.last_name}`,
      issuedOn: invoice.issued_on,
      billedCents,
      receivedCents,
      refundedCents,
      note,
    }];
  }).sort((a, b) => a.childName.localeCompare(b.childName)
    || a.invoiceNumber.localeCompare(b.invoiceNumber));
}
