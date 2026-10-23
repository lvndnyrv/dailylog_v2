import {
  getFamily,
  getMyDaycare,
  getMyProfile,
  listFamilyInvoices,
  listFamilyLedger,
  listFamilyPaymentsForReview,
} from "@dailylog/db/queries";
import type { FamilyLedgerEntry, FamilyPaymentReviewRow } from "@dailylog/db/queries";
import type { Tables } from "@dailylog/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnualLineReview, type AnnualReviewLine } from "@/components/billing/annual-line-review";
import { AnnualPaymentAllocation, type AnnualPaymentEvent } from "@/components/billing/annual-payment-allocation";
import { AnnualAdjustmentReview, type AnnualAdjustmentItem, type AnnualAdjustmentLineOption } from "@/components/billing/annual-adjustment-review";
import { AnnualTimingReview } from "@/components/billing/annual-timing-review";
import { SectionHeader } from "@/components/shell/header";
import { dateInTimeZone } from "@/lib/center-date";
import { annualReconciliationIssues } from "@/lib/billing/annual-reconciliation";
import { annualChildWorksheets } from "@/lib/billing/annual-child-worksheet";
import { annualInvoiceTiming } from "@/lib/billing/annual-invoice-timing";
import { getServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const card = "rounded-2xl border border-[#D6E1F0] bg-card p-5";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function date(value: string | null): string {
  if (!value) return "—";
  const safeValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  return new Date(safeValue).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function withRunningBalances(entries: FamilyLedgerEntry[]) {
  let balance = entries.reduce((sum, entry) => sum + entry.amount_cents, 0);
  return entries.map((entry) => {
    const row = { ...entry, runningBalance: balance };
    balance -= entry.amount_cents;
    return row;
  });
}

function paymentYear(value: string | null, timeZone: string): number | null {
  if (!value) return null;
  return Number(dateInTimeZone(value, timeZone).slice(0, 4));
}

function yearEndReview(payments: FamilyPaymentReviewRow[], year: number, timeZone: string) {
  const byChild = new Map<string, { id: string; name: string; received: number; refunded: number; count: number }>();
  const unassigned: FamilyPaymentReviewRow[] = [];
  let missingPaymentDates = 0;
  let missingRefundDates = 0;
  let nonCadEvents = 0;

  for (const payment of payments) {
    const receivedInYear = paymentYear(payment.paid_at, timeZone) === year;
    const refundedInYear = payment.status === "refunded"
      && paymentYear(payment.refunded_at, timeZone) === year;
    if (!payment.paid_at) missingPaymentDates += 1;
    if (payment.status === "refunded" && !payment.refunded_at) missingRefundDates += 1;
    if (!receivedInYear && !refundedInYear) continue;
    if (payment.currency !== "CAD") {
      nonCadEvents += 1;
      continue;
    }

    const child = payment.invoice?.child;
    if (!child) {
      unassigned.push(payment);
      continue;
    }
    const row = byChild.get(child.id) ?? {
      id: child.id,
      name: `${child.first_name} ${child.last_name}`,
      received: 0,
      refunded: 0,
      count: 0,
    };
    if (receivedInYear) row.received += payment.amount_cents;
    if (refundedInYear) row.refunded += payment.amount_cents;
    row.count += 1;
    byChild.set(child.id, row);
  }

  return {
    rows: [...byChild.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unassigned,
    missingPaymentDates,
    missingRefundDates,
    nonCadEvents,
  };
}

export default async function FamilyStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) notFound();

  const family = await getFamily(supabase, id).catch((error: { code?: string }) => {
    if (error.code === "PGRST116") notFound();
    throw error;
  });
  if (family.daycare_id !== profile.daycare_id) notFound();

  const [entries, invoices, payments, daycare, billingEditPermission] = await Promise.all([
    listFamilyLedger(supabase, family.id),
    listFamilyInvoices(supabase, family.id),
    listFamilyPaymentsForReview(supabase, family.id),
    getMyDaycare(supabase),
    supabase.rpc("has_permission", { p_area: "billing", p_action: "edit" }),
  ]);
  const canEditBilling = ["owner_admin", "admin"].includes(profile.role)
    && !billingEditPermission.error && Boolean(billingEditPermission.data);
  const { data: taxProfile, error: taxProfileError } = canEditBilling
    ? await supabase.from("billing_tax_profiles")
      .select("legal_name, statement_address, signer_name, signer_title")
      .eq("daycare_id", profile.daycare_id)
      .maybeSingle()
    : { data: null, error: null };
  if (taxProfileError) throw taxProfileError;
  const providerDetailsRecorded = Boolean(taxProfile?.legal_name && taxProfile.statement_address
    && taxProfile.signer_name && taxProfile.signer_title);
  const timeZone = daycare?.timezone ?? "America/Toronto";
  const today = dateInTimeZone(new Date(), timeZone);
  const currentYear = Number(today.slice(0, 4));
  const availableYears = [currentYear, currentYear - 1, currentYear - 2];
  const requestedYear = Number((await searchParams).year);
  const reviewYear = availableYears.includes(requestedYear) ? requestedYear : currentYear - 1;
  const yearReview = yearEndReview(payments, reviewYear, timeZone);
  const reviewedInvoiceIds = new Set(payments
    .filter((payment) => payment.currency === "CAD" && payment.invoice
      && (paymentYear(payment.paid_at, timeZone) === reviewYear
        || (payment.status === "refunded" && paymentYear(payment.refunded_at, timeZone) === reviewYear)))
    .map((payment) => payment.invoice!.id));
  const { data: savedLineReviews, error: lineReviewsError } = canEditBilling
    ? await supabase.from("billing_annual_line_reviews")
      .select("invoice_line_id, classification, note, reviewed_at, reviewed_line_description, reviewed_line_amount_cents, service_start_on, service_end_on, service_evidence_note")
      .eq("family_id", family.id).eq("review_year", reviewYear)
    : { data: null, error: null };
  if (lineReviewsError) throw lineReviewsError;
  const savedReviewByLine = new Map((savedLineReviews ?? []).map((review) => [review.invoice_line_id, review]));
  const annualReviewLines: AnnualReviewLine[] = invoices
    .filter((invoice) => reviewedInvoiceIds.has(invoice.id) && invoice.child && invoice.status !== "void")
    .flatMap((invoice) => invoice.lines.map((line) => {
      const saved = savedReviewByLine.get(line.id);
      return {
        id: line.id,
        childId: invoice.child!.id,
        invoiceNumber: invoice.number ?? "Invoice",
        childName: `${invoice.child!.first_name} ${invoice.child!.last_name}`,
        description: line.description,
        amountCents: line.amount_cents,
        classification: saved?.classification ?? "needs_review",
        note: saved?.note ?? "",
        stale: Boolean(saved && (saved.reviewed_line_description !== line.description
          || saved.reviewed_line_amount_cents !== line.amount_cents)),
        reviewedAt: saved?.reviewed_at ?? null,
        serviceStartOn: saved?.service_start_on ?? "",
        serviceEndOn: saved?.service_end_on ?? "",
        serviceEvidenceNote: saved?.service_evidence_note ?? "",
      };
    }))
    .sort((a, b) => a.childName.localeCompare(b.childName)
      || a.invoiceNumber.localeCompare(b.invoiceNumber) || a.description.localeCompare(b.description));
  type SavedAllocation = Pick<Tables<"billing_annual_payment_allocations">,
    "payment_id" | "event_kind" | "invoice_line_id" | "amount_cents">;
  const savedAllocations: SavedAllocation[] = [];
  if (canEditBilling) {
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("billing_annual_payment_allocations")
        .select("payment_id, event_kind, invoice_line_id, amount_cents")
        .eq("family_id", family.id)
        .order("payment_id").order("event_kind").order("invoice_line_id")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      savedAllocations.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
  }
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const annualPaymentEvents: AnnualPaymentEvent[] = payments.flatMap((payment) => {
    const invoice = payment.invoice && invoicesById.get(payment.invoice.id);
    if (payment.currency !== "CAD" || !invoice?.child || invoice.status === "void") return [];
    const kinds: ("received" | "refunded")[] = [];
    if (paymentYear(payment.paid_at, timeZone) === reviewYear) kinds.push("received");
    if (payment.status === "refunded" && paymentYear(payment.refunded_at, timeZone) === reviewYear) kinds.push("refunded");
    return kinds.map((kind) => {
      const currentAllocations = savedAllocations.filter((entry) => entry.payment_id === payment.id && entry.event_kind === kind);
      const originalAllocated = savedAllocations.filter((entry) => entry.payment_id === payment.id && entry.event_kind === "received")
        .reduce((sum, entry) => sum + entry.amount_cents, 0) === payment.amount_cents;
      return {
        paymentId: payment.id,
        childId: invoice.child!.id,
        kind,
        amountCents: payment.amount_cents,
        invoiceNumber: invoice.number ?? "Invoice",
        childName: `${invoice.child!.first_name} ${invoice.child!.last_name}`,
        eventDate: date(kind === "received" ? payment.paid_at : payment.refunded_at),
        linesMatchTotal: invoice.lines.reduce((sum, line) => sum + line.amount_cents, 0) === invoice.total_cents,
        allReviewed: invoice.lines.length > 0 && invoice.lines.every((line) => {
          const saved = savedReviewByLine.get(line.id);
          return saved && saved.classification !== "needs_review"
            && saved.reviewed_line_description === line.description
            && saved.reviewed_line_amount_cents === line.amount_cents;
        }),
        originalReceiptAllocated: originalAllocated,
        lines: invoice.lines.map((line) => ({
          id: line.id,
          description: line.description,
          classification: savedReviewByLine.get(line.id)?.classification ?? "needs_review",
          amountCents: line.amount_cents,
          allocatedCents: currentAllocations.find((entry) => entry.invoice_line_id === line.id)?.amount_cents ?? 0,
        })),
      };
    });
  }).sort((a, b) => a.childName.localeCompare(b.childName)
    || a.eventDate.localeCompare(b.eventDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  const balance = entries.reduce((sum, entry) => sum + entry.amount_cents, 0);
  const invoiceBalances = invoices.map((invoice) => {
    const paid = invoice.payments
      .filter((payment) => payment.status === "succeeded")
      .reduce((sum, payment) => sum + payment.amount_cents, 0);
    return { invoice, remaining: Math.max(0, invoice.total_cents - paid) };
  });
  const outstanding = invoiceBalances
    .filter(({ invoice }) => invoice.status === "open" || invoice.status === "overdue")
    .reduce((sum, { remaining }) => sum + remaining, 0);
  const ledgerRows = withRunningBalances(entries);
  const yearManualEntries = entries.filter((entry) => ["credit", "adjustment", "writeoff"].includes(entry.entry_type)
    && dateInTimeZone(entry.effective_at, timeZone).slice(0, 4) === String(reviewYear));
  const manualLedgerEntries = yearManualEntries.filter((entry) => entry.currency === "CAD");
  const nonCadManualCount = yearManualEntries.length - manualLedgerEntries.length;
  type SavedAdjustment = Pick<Tables<"billing_annual_adjustment_reviews">,
    "ledger_entry_id" | "disposition" | "invoice_line_id" | "note" | "reviewed_at"
    | "reviewed_entry_amount_cents" | "reviewed_entry_description" | "reviewed_entry_effective_at"
    | "reviewed_line_description" | "reviewed_line_amount_cents">;
  const savedAdjustmentReviews: SavedAdjustment[] = [];
  if (canEditBilling) {
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("billing_annual_adjustment_reviews")
        .select("ledger_entry_id, disposition, invoice_line_id, note, reviewed_at, reviewed_entry_amount_cents, reviewed_entry_description, reviewed_entry_effective_at, reviewed_line_description, reviewed_line_amount_cents")
        .eq("family_id", family.id).eq("review_year", reviewYear)
        .order("ledger_entry_id").range(from, from + pageSize - 1);
      if (error) throw error;
      savedAdjustmentReviews.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
  }
  const adjustmentReviewById = new Map(savedAdjustmentReviews.map((review) => [review.ledger_entry_id, review]));
  const adjustmentLines: AnnualAdjustmentLineOption[] = invoices
    .filter((invoice) => invoice.child && invoice.status !== "void")
    .flatMap((invoice) => invoice.lines.map((line) => ({
      id: line.id,
      invoiceId: invoice.id,
      description: line.description,
      amountCents: line.amount_cents,
      label: `${invoice.number ?? "Invoice"} · ${invoice.child!.first_name} ${invoice.child!.last_name} · ${line.description} · ${money(line.amount_cents)}`,
    })));
  const adjustmentLineById = new Map(adjustmentLines.map((line) => [line.id, line]));
  const annualAdjustmentItems: AnnualAdjustmentItem[] = manualLedgerEntries.map((entry) => {
    const saved = adjustmentReviewById.get(entry.id);
    const line = saved?.invoice_line_id ? adjustmentLineById.get(saved.invoice_line_id) : null;
    return {
      id: entry.id,
      type: entry.entry_type,
      amountCents: entry.amount_cents,
      description: entry.description,
      date: date(entry.effective_at),
      sourceInvoiceId: entry.source_invoice_id,
      disposition: saved?.disposition ?? "needs_review",
      invoiceLineId: saved?.invoice_line_id ?? null,
      note: saved?.note ?? "",
      reviewedAt: saved?.reviewed_at ?? null,
      stale: Boolean(saved && (saved.reviewed_entry_amount_cents !== entry.amount_cents
        || saved.reviewed_entry_description !== entry.description
        || saved.reviewed_entry_effective_at !== entry.effective_at
        || (saved.invoice_line_id && (!line || line.description !== saved.reviewed_line_description
          || line.amountCents !== saved.reviewed_line_amount_cents)))),
    };
  });
  const unreviewableChildEvents = payments.reduce((count, payment) => {
    if (payment.currency !== "CAD" || !payment.invoice?.child) return count;
    const invoice = invoicesById.get(payment.invoice.id);
    if (invoice && invoice.status !== "void") return count;
    return count + Number(paymentYear(payment.paid_at, timeZone) === reviewYear)
      + Number(payment.status === "refunded" && paymentYear(payment.refunded_at, timeZone) === reviewYear);
  }, 0);
  const childWorksheets = canEditBilling
    ? annualChildWorksheets(reviewYear, yearReview.rows, annualReviewLines, annualPaymentEvents)
    : [];
  const invoiceTiming = canEditBilling
    ? annualInvoiceTiming(reviewYear, invoices, payments, (value) => paymentYear(value, timeZone))
    : [];
  const { data: savedTimingReviews, error: timingReviewsError } = canEditBilling
    ? await supabase.from("billing_annual_invoice_timing_reviews")
      .select("invoice_id, disposition, note, reviewed_at, reviewed_issued_on, reviewed_invoice_status, reviewed_invoice_total_cents, reviewed_billed_cents, reviewed_received_cents, reviewed_refunded_cents")
      .eq("family_id", family.id).eq("review_year", reviewYear)
    : { data: null, error: null };
  if (timingReviewsError) throw timingReviewsError;
  const timingReviewByInvoice = new Map((savedTimingReviews ?? []).map((review) => [review.invoice_id, review]));
  const timingReviewRows = invoiceTiming.map((row) => {
    const saved = timingReviewByInvoice.get(row.invoiceId);
    const invoice = invoicesById.get(row.invoiceId);
    const stale = Boolean(saved && invoice && (
      saved.reviewed_issued_on !== invoice.issued_on
      || saved.reviewed_invoice_status !== invoice.status
      || saved.reviewed_invoice_total_cents !== invoice.total_cents
      || saved.reviewed_billed_cents !== row.billedCents
      || saved.reviewed_received_cents !== row.receivedCents
      || saved.reviewed_refunded_cents !== row.refundedCents
    ));
    return { ...row, saved, stale };
  });
  const unresolvedTimingCount = timingReviewRows.filter((row) =>
    row.billedCents !== row.receivedCents - row.refundedCents
    && (!row.saved || row.stale || row.saved.disposition === "accounting_followup")).length;
  const reconciliationIssues = canEditBilling ? annualReconciliationIssues({
    providerDetailsRecorded,
    reviewYear,
    eventCount: annualPaymentEvents.length,
    unassignedPaymentCount: yearReview.unassigned.length,
    missingPaymentDates: yearReview.missingPaymentDates,
    missingRefundDates: yearReview.missingRefundDates,
    nonCadPaymentCount: yearReview.nonCadEvents,
    unreviewableChildEvents,
    nonCadManualCount,
    unresolvedTimingCount,
    lines: annualReviewLines,
    events: annualPaymentEvents,
    adjustments: annualAdjustmentItems,
  }) : [];
  const timingBilled = invoiceTiming.reduce((sum, row) => sum + row.billedCents, 0);
  const timingNetPaid = invoiceTiming.reduce((sum, row) => sum + row.receivedCents - row.refundedCents, 0);
  const children = family.children
    .filter((entry) => entry.child)
    .map((entry) => `${entry.child!.first_name} ${entry.child!.last_name}`);

  return (
    <>
      <SectionHeader title={family.display_name} subtitle="Family statement · charges, payments and credits" />
      <main className="flex flex-col gap-5 p-4 md:p-7">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/billing" className="w-fit text-[13px] font-bold text-primary hover:underline">← Billing</Link>
          <a href="#year-end-review" className="text-[13px] font-bold text-primary hover:underline">Year-end payment review ↓</a>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className={card}>
            <span className="font-mono text-[10.5px] font-bold tracking-[.08em] text-faint">LEDGER BALANCE</span>
            <strong className="mt-1 block text-[23px] text-ink">{money(balance)}</strong>
            <p className="mt-1 text-[11.5px] text-muted">Includes charges, settled payments, refunds and credits.</p>
          </div>
          <div className={card}>
            <span className="font-mono text-[10.5px] font-bold tracking-[.08em] text-faint">OPEN INVOICES</span>
            <strong className="mt-1 block text-[23px] text-ink">{money(outstanding)}</strong>
            <p className="mt-1 text-[11.5px] text-muted">Unpaid invoice amounts before other account credits.</p>
          </div>
          <div className={card}>
            <span className="font-mono text-[10.5px] font-bold tracking-[.08em] text-faint">HOUSEHOLD</span>
            <strong className="mt-1 block text-[15px] text-ink">{children.join(", ") || "No child linked"}</strong>
            <p className="mt-1 text-[11.5px] text-muted">{family.billing_email ?? "No billing email on file"}</p>
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card">
          <div className="border-b border-[#EDF3FB] px-5 py-4">
            <h2 className="text-[16px] font-extrabold text-ink">Ledger</h2>
            <p className="mt-0.5 text-[12px] text-muted">Every charge, payment, refund and credit; newest first.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-[12.5px]">
              <thead className="bg-[#F8FBFE] font-mono text-[10.5px] tracking-[.07em] text-faint">
                <tr><th className="px-5 py-3">DATE</th><th className="px-5 py-3">ITEM</th><th className="px-5 py-3 text-right">AMOUNT</th><th className="px-5 py-3 text-right">BALANCE</th></tr>
              </thead>
              <tbody>
                {ledgerRows.map((entry) => (
                  <tr key={entry.id} className="border-t border-[#EDF3FB]">
                    <td className="whitespace-nowrap px-5 py-3 text-muted">{date(entry.effective_at)}</td>
                    <td className="px-5 py-3">
                      <span className="block font-semibold text-ink">{entry.description}</span>
                      <span className="text-[11px] capitalize text-faint">{entry.entry_type}</span>
                      {entry.source_invoice_id && <Link href={`/billing?invoice=${entry.source_invoice_id}`} className="ml-2 text-[11px] font-bold text-primary hover:underline">View invoice</Link>}
                    </td>
                    <td className={`whitespace-nowrap px-5 py-3 text-right font-semibold ${entry.amount_cents < 0 ? "text-success" : "text-ink"}`}>{entry.amount_cents > 0 ? "+" : "−"}{money(Math.abs(entry.amount_cents))}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right font-bold text-ink">{money(entry.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ledgerRows.length === 0 && <p className="px-5 py-8 text-center text-[12.5px] text-faint">No account activity yet.</p>}
          </div>
        </section>

        <section id="year-end-review" className="overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card">
          <div className="border-b border-[#EDF3FB] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[16px] font-extrabold text-ink">{reviewYear} payment review{reviewYear === currentYear ? " · year to date" : " · year end"}</h2>
              <div className="flex gap-2" aria-label="Review year">
                {availableYears.map((year) => (
                  <Link
                    key={year}
                    href={`/billing/families/${family.id}?year=${year}`}
                    aria-current={reviewYear === year ? "page" : undefined}
                    className={`rounded-full border px-3 py-1 text-[11px] font-bold ${reviewYear === year ? "border-primary bg-primary text-white" : "border-[#D6E1F0] text-muted hover:text-primary"}`}
                  >{year}</Link>
                ))}
              </div>
            </div>
            <p className="mt-0.5 text-[12px] text-muted">Payment and refund dates in the center’s time zone, grouped by the child on each invoice. This is not a tax statement or an eligible-expense total; tuition, fees, credits and provider details still need review before publication.</p>
          </div>
          {canEditBilling && <div className={`border-b px-5 py-4 text-[12px] ${providerDetailsRecorded ? "border-[#D6E1F0] bg-[#F4F8FD] text-ink" : "border-[#EFD9B5] bg-warning-bg text-warning-text"}`}>
            <strong>{providerDetailsRecorded ? "Provider details recorded." : "Provider details missing."}</strong>{" "}
            {providerDetailsRecorded
              ? "Confirm the details and local statement requirements before preparing any document."
              : "Add the legal name, statement address and signer in Settings before preparing any document."}{" "}
            <Link href="/settings" className="font-bold text-primary hover:underline">Review provider profile →</Link>
          </div>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[580px] text-left text-[12.5px]">
              <thead className="bg-[#F8FBFE] font-mono text-[10.5px] tracking-[.07em] text-faint">
                <tr><th className="px-5 py-3">CHILD</th><th className="px-5 py-3 text-right">RECEIVED</th><th className="px-5 py-3 text-right">REFUNDED</th><th className="px-5 py-3 text-right">NET ACTIVITY</th></tr>
              </thead>
              <tbody>
                {yearReview.rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#EDF3FB]">
                    <td className="px-5 py-3"><span className="font-semibold text-ink">{row.name}</span><span className="ml-2 text-[11px] text-faint">{row.count} payment records</span></td>
                    <td className="px-5 py-3 text-right text-ink">{money(row.received)}</td>
                    <td className="px-5 py-3 text-right text-ink">{money(row.refunded)}</td>
                    <td className="px-5 py-3 text-right font-bold text-ink">{money(row.received - row.refunded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {yearReview.rows.length === 0 && <p className="px-5 py-8 text-center text-[12.5px] text-faint">No child-linked payments or refunds recorded for {reviewYear}.</p>}
          </div>
          <div className="border-t border-[#EDF3FB] px-5 py-4 text-[12px] text-muted">
            <strong className="text-ink">Review before generating statements:</strong> {yearReview.unassigned.length} payment records without a child-linked invoice; {yearReview.missingPaymentDates} historical records without a payment date; {yearReview.missingRefundDates} historical refunds without a refund date; {yearReview.nonCadEvents} non-CAD records in this year (excluded from CAD totals).
            {yearReview.unassigned.length > 0 && <p className="mt-2 text-amber-700">Unassigned payment activity cannot be put on a child’s statement automatically. Reconcile it against the ledger first.</p>}
          </div>
        </section>

        {canEditBilling && <section className="overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card" aria-labelledby="annual-reconciliation-title">
          <div className="border-b border-[#EDF3FB] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="annual-reconciliation-title" className="text-[16px] font-extrabold text-ink">Annual reconciliation checklist · {reviewYear}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/billing/families/${family.id}/review-export?year=${reviewYear}`}
                  className="rounded-full border border-[#D6E1F0] bg-white px-3 py-1 text-[11px] font-bold text-primary hover:bg-[#F8FBFE]">
                  Download private review evidence ↓
                </a>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${reconciliationIssues.length ? "bg-warning-bg text-warning-text" : "bg-[#E8F5EF] text-success"}`}>
                  {reconciliationIssues.length ? `${reconciliationIssues.length} open checks` : "Operational checks clear"}
                </span>
              </div>
            </div>
            <p className="mt-1 text-[12px] text-muted">This checks recorded data only. The private CSV carries source records and review decisions for an accountant; it is not a family document or a tax total. Even with no open checks, a person must verify accounting and local requirements, explicitly approve a final document, and publish it separately.</p>
          </div>
          {reconciliationIssues.length ? <div className="divide-y divide-[#EDF3FB]">
            {reconciliationIssues.map((issue) => <Link key={issue.id} href={issue.href}
              className="flex flex-wrap items-start gap-3 px-5 py-3 hover:bg-[#F8FBFE]">
              <span className="min-w-0 flex-1">
                <strong className="block text-[12.5px] text-ink">{issue.title}</strong>
                <span className="text-[11px] text-muted">{issue.detail}</span>
              </span>
              <span className="rounded-full bg-warning-bg px-2 py-1 text-[11px] font-bold text-warning-text">{issue.count}</span>
              <span aria-hidden="true" className="text-primary">→</span>
            </Link>)}
          </div> : <p className="px-5 py-4 text-[12px] font-semibold text-success">No operational data gaps detected for this selected year. This is not tax eligibility, approval or publication.</p>}
        </section>}

        {canEditBilling && <section className="overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card" aria-labelledby="annual-child-worksheet-title">
          <div className="border-b border-[#EDF3FB] px-5 py-4">
            <h2 id="annual-child-worksheet-title" className="text-[16px] font-extrabold text-ink">Child-by-child worksheet · {reviewYear}</h2>
            <p className="mt-1 text-[12px] text-muted">Private reconciliation aid. Received and refunded amounts are recorded cash activity, not child-care expenses. A reviewed care allocation is shown only when that child’s invoice events, line decisions and same-year care-date evidence are complete. It is still not a tax-eligible amount or a family document.</p>
          </div>
          <div className="divide-y divide-[#EDF3FB]">
            {childWorksheets.map((row) => <div key={row.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-[13px] font-bold text-ink">{row.name}</h3>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.gaps.length ? "bg-warning-bg text-warning-text" : "bg-[#E8F5EF] text-success"}`}>
                  {row.gaps.length ? "Review incomplete" : "Allocation reconciled · human review required"}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="block text-muted">Received</span><strong className="text-ink">{money(row.received)}</strong></div>
                <div><span className="block text-muted">Refunded</span><strong className="text-ink">{money(row.refunded)}</strong></div>
                <div><span className="block text-muted">Reviewed care allocation, net</span><strong className="text-ink">{row.candidateCents === null ? "Pending" : money(row.candidateCents)}</strong></div>
                <div><span className="block text-muted">Excluded allocation, net</span><strong className="text-ink">{row.excludedCents === null ? "Pending" : money(row.excludedCents)}</strong></div>
              </div>
              {row.gaps.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-[11.5px] text-warning-text">
                {row.gaps.map((gap) => <li key={gap}>{gap}</li>)}
              </ul>}
            </div>)}
            {childWorksheets.length === 0 && <p className="px-5 py-6 text-[12px] text-muted">No child-linked CAD activity for this year. There is no worksheet to prepare.</p>}
          </div>
          <p className="border-t border-[#EDF3FB] bg-[#F8FBFE] px-5 py-3 text-[11px] text-muted">Household adjustments and unassigned records remain outside child subtotals. Check the household reconciliation above before considering any document.</p>
        </section>}

        {canEditBilling && <section id="invoice-timing-review" className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card" aria-labelledby="invoice-timing-title">
          <div className="border-b border-[#EDF3FB] px-5 py-4">
            <h2 id="invoice-timing-title" className="text-[16px] font-extrabold text-ink">Invoice and payment timing · {reviewYear}</h2>
            <p className="mt-1 text-[12px] text-muted">An invoice dated in one year can be paid or refunded in another. This comparison explains differences; it does not change the ledger, resolve an accounting question, or select a tax-reporting method.</p>
          </div>
          <div className="grid gap-3 border-b border-[#EDF3FB] bg-[#F8FBFE] p-5 sm:grid-cols-3">
            <div><span className="block text-[11px] font-bold text-muted">ACTIVE INVOICES ISSUED</span><strong className="text-[17px] text-ink">{money(timingBilled)}</strong></div>
            <div><span className="block text-[11px] font-bold text-muted">NET LINKED PAYMENT ACTIVITY</span><strong className="text-[17px] text-ink">{money(timingNetPaid)}</strong></div>
            <div><span className="block text-[11px] font-bold text-muted">TIMING / SETTLEMENT DIFFERENCE</span><strong className="text-[17px] text-ink">{money(timingBilled - timingNetPaid)}</strong></div>
          </div>
          <p className="px-5 pt-3 text-[11px] text-muted">CAD, child-linked active invoices only for billed amounts; the payment figure includes their recorded receipts less refunds in this year. Unassigned payments, manual adjustments and non-CAD activity are excluded and flagged in the household checklist.</p>
          <div className="divide-y divide-[#EDF3FB]">
            {timingReviewRows.map((row) => <div key={row.invoiceId} className="px-5 py-3 text-[12px]">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-[180px] flex-1">
                  <strong className="block text-ink">{row.childName} · {row.invoiceNumber}</strong>
                  <span className="text-[11px] text-muted">Issued {date(row.issuedOn)} · {row.note}</span>
                </span>
                <span className="text-right text-muted">Billed <strong className="block text-ink">{money(row.billedCents)}</strong></span>
                <span className="text-right text-muted">Net paid <strong className="block text-ink">{money(row.receivedCents - row.refundedCents)}</strong></span>
                <Link href={`/billing?invoice=${row.invoiceId}`} className="font-bold text-primary hover:underline">View invoice →</Link>
              </div>
              {row.billedCents !== row.receivedCents - row.refundedCents && <AnnualTimingReview
                familyId={family.id} year={reviewYear} item={{
                  invoiceId: row.invoiceId,
                  invoiceNumber: row.invoiceNumber,
                  billedCents: row.billedCents,
                  receivedCents: row.receivedCents,
                  refundedCents: row.refundedCents,
                  disposition: row.saved?.disposition ?? "accounting_followup",
                  note: row.saved?.note ?? "",
                  reviewedAt: row.saved?.reviewed_at ?? null,
                  stale: row.stale,
                }} />}
            </div>)}
            {invoiceTiming.length === 0 && <p className="px-5 py-6 text-[12px] text-muted">No child-linked CAD invoices or payment activity to compare in this year.</p>}
          </div>
        </section>}

        {canEditBilling && <AnnualLineReview familyId={family.id} year={reviewYear} lines={annualReviewLines} />}

        {canEditBilling && <AnnualPaymentAllocation familyId={family.id} year={reviewYear} events={annualPaymentEvents} />}

        {canEditBilling && <AnnualAdjustmentReview familyId={family.id} year={reviewYear}
          items={annualAdjustmentItems} lines={adjustmentLines} nonCadCount={nonCadManualCount} />}

        <section className="overflow-hidden rounded-2xl border border-[#D6E1F0] bg-card">
          <div className="border-b border-[#EDF3FB] px-5 py-4">
            <h2 className="text-[16px] font-extrabold text-ink">Invoices</h2>
            <p className="mt-0.5 text-[12px] text-muted">Recorded invoice totals and what remains to be paid.</p>
          </div>
          <div className="divide-y divide-[#EDF3FB]">
            {invoiceBalances.map(({ invoice, remaining }) => (
              <Link href={`/billing?invoice=${invoice.id}`} key={invoice.id} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-[#F8FBFE]">
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[12px] font-semibold text-ink">{invoice.number ?? "Invoice"}</span>
                  <span className="block text-[11.5px] text-muted">{invoice.child ? `${invoice.child.first_name} ${invoice.child.last_name} · ` : ""}Due {date(invoice.due_on)} · <span className="capitalize">{(invoice.status === "open" || invoice.status === "overdue") && invoice.due_on && invoice.due_on < today ? "overdue" : invoice.status}</span></span>
                </span>
                <span className="text-right text-[12.5px] font-bold text-ink">{money(remaining)} remaining<span className="block text-[11px] font-normal text-muted">of {money(invoice.total_cents)}</span></span>
                <span className="font-bold text-primary">→</span>
              </Link>
            ))}
            {invoiceBalances.length === 0 && <p className="px-5 py-8 text-center text-[12.5px] text-faint">No invoices yet.</p>}
          </div>
        </section>
      </main>
    </>
  );
}

export function generateMetadata() {
  return { title: "Family statement — DailyLog Admin" };
}
