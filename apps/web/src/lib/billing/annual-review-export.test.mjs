import assert from 'node:assert/strict';
import test from 'node:test';
import { annualReviewExportRows } from './annual-review-export.ts';
import { csvRows } from '../csv.ts';

const child = { id: 'child-1', first_name: 'Mateo', last_name: 'Castillo' };
const invoice = {
  id: 'invoice-1', number: 'INV-1', issued_on: '2026-08-01', status: 'open',
  total_cents: 124000, currency: 'CAD', child,
  lines: [{ id: 'line-1', description: 'August care', amount_cents: 124000, quantity: 1 }],
};
const base = {
  year: 2026, centerId: 'center-1', centerName: 'Sunny Grove',
  familyId: 'family-1', familyName: 'Castillo', generatedAt: '2026-10-19T12:00:00.000Z',
  timeZone: 'America/Toronto',
  invoices: [invoice], payments: [], ledger: [], lineReviews: [], allocations: [],
  adjustmentReviews: [], timingReviews: [], eventYear: (value) => value ? Number(value.slice(0, 4)) : null,
  timingRows: [{ invoiceId: 'invoice-1', invoiceNumber: 'INV-1', childId: 'child-1',
    childName: 'Mateo Castillo', issuedOn: '2026-08-01', billedCents: 124000,
    receivedCents: 0, refundedCents: 0, note: 'Billed with no payment' }],
};

test('private export carries source amounts and unresolved decisions, not a tax total', () => {
  const rows = annualReviewExportRows(base);
  assert.match(rows[1][0], /NOT A TAX STATEMENT/);
  assert.deepEqual(rows[2], ['Center', 'Sunny Grove', 'Center ID', 'center-1']);
  assert.deepEqual(rows[3], ['Family', 'Castillo', 'Family ID', 'family-1']);
  assert.equal(rows.find((row) => row[0] === 'invoice line')[14], 'child-1');
  assert.deepEqual(rows.filter((row) => row[0] === 'invoice line').map((row) =>
    [row[7], row[8], row[9]]), [[124000, 'needs_review', 'unreviewed']]);
  assert.deepEqual(rows.filter((row) => row[0] === 'invoice/payment difference').map((row) =>
    [row[7], row[8], row[9]]), [[124000, 'accounting_followup', 'unreviewed']]);
  assert.equal(rows.some((row) => row.includes('eligible total')), false);
});

test('changed source snapshots are marked stale and exported note text is spreadsheet-safe', () => {
  const rows = annualReviewExportRows({ ...base,
    lineReviews: [{ invoice_line_id: 'line-1', classification: 'care_service_candidate',
      note: '=HYPERLINK("bad")', reviewed_line_description: 'Old description',
      reviewed_line_amount_cents: 124000, service_start_on: '2026-08-01',
      service_end_on: '2026-08-31', service_evidence_note: 'Enrollment agreement',
      reviewed_at: '2026-10-01T00:00:00Z' }],
    timingReviews: [{ invoice_id: 'invoice-1', disposition: 'explained_open_balance',
      note: 'Awaiting payment', reviewed_issued_on: '2026-08-01',
      reviewed_invoice_status: 'open', reviewed_invoice_total_cents: 124000,
      reviewed_billed_cents: 124000, reviewed_received_cents: 10000, reviewed_refunded_cents: 0,
      reviewed_at: '2026-10-01T00:00:00Z' }],
  });
  assert.equal(rows.find((row) => row[0] === 'invoice line')[9], 'stale');
  assert.equal(rows.find((row) => row[0] === 'invoice/payment difference')[9], 'stale');
  assert.match(csvRows(rows), /"\t=HYPERLINK/);
});

test('cross-year receipts and missing-date refunds remain visible for human reconciliation', () => {
  const rows = annualReviewExportRows({ ...base, year: 2026, invoices: [{ ...invoice, issued_on: '2025-12-01' }],
    payments: [{ id: 'payment-1', amount_cents: 124000, currency: 'CAD', status: 'refunded',
      paid_at: '2026-01-03T15:00:00Z', refunded_at: null,
      invoice: { id: 'invoice-1', number: 'INV-1', child } }],
  });
  assert.equal(rows.filter((row) => row[0] === 'receipt').length, 1);
  assert.equal(rows.filter((row) => row[0] === 'refund with missing date').length, 1);
  assert.equal(rows.filter((row) => row[0] === 'invoice').length, 1);
});

test('payment keeps its child identity if the full invoice is missing from the export query', () => {
  const rows = annualReviewExportRows({ ...base, invoices: [], timingRows: [],
    payments: [{ id: 'payment-2', amount_cents: 12000, currency: 'CAD', status: 'succeeded',
      paid_at: '2026-10-02T12:00:00Z', refunded_at: null,
      invoice: { id: 'invoice-2', number: 'INV-2', child } }],
  });
  const receipt = rows.find((row) => row[0] === 'receipt');
  assert.equal(receipt[1], 'Mateo Castillo');
  assert.equal(receipt[14], 'child-1');
});
