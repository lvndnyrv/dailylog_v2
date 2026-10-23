import assert from 'node:assert/strict';
import test from 'node:test';
import { annualInvoiceTiming } from './annual-invoice-timing.ts';

const child = { id: 'child-1', first_name: 'Luca', last_name: 'Ferreira' };
const invoice = { id: 'invoice-1', number: 'INV-1', status: 'paid',
  issued_on: '2025-11-27', total_cents: 78000, currency: 'CAD', child };
const payment = { amount_cents: 78000, currency: 'CAD', status: 'succeeded',
  paid_at: '2026-01-03T15:00:00Z', refunded_at: null, invoice: { id: 'invoice-1' } };
const utcYear = (value) => value ? Number(value.slice(0, 4)) : null;

test('cross-year payment explains billed-vs-paid difference without changing either amount', () => {
  const prior = annualInvoiceTiming(2025, [invoice], [payment], utcYear);
  assert.equal(prior[0].billedCents, 78000);
  assert.equal(prior[0].receivedCents, 0);
  assert.match(prior[0].note, /no net payment/);
  const next = annualInvoiceTiming(2026, [invoice], [payment], utcYear);
  assert.equal(next[0].billedCents, 0);
  assert.equal(next[0].receivedCents, 78000);
  assert.match(next[0].note, /another year/);
});

test('refund is subtracted only in its own event year', () => {
  const refunded = { ...payment, status: 'refunded', paid_at: '2025-12-10T15:00:00Z',
    refunded_at: '2026-02-04T15:00:00Z' };
  assert.deepEqual(annualInvoiceTiming(2025, [invoice], [refunded], utcYear)
    .map((row) => [row.receivedCents, row.refundedCents]), [[78000, 0]]);
  assert.deepEqual(annualInvoiceTiming(2026, [invoice], [refunded], utcYear)
    .map((row) => [row.receivedCents, row.refundedCents]), [[0, 78000]]);
});

test('void invoices, foreign currency and unrelated payments do not inflate billed amount', () => {
  const result = annualInvoiceTiming(2025, [{ ...invoice, status: 'void' }], [
    { ...payment, paid_at: '2025-12-01T15:00:00Z', currency: 'USD' },
    { ...payment, paid_at: '2025-12-01T15:00:00Z', invoice: { id: 'other' } },
  ], utcYear);
  assert.equal(result[0].billedCents, 0);
  assert.equal(result[0].receivedCents, 0);
  assert.match(result[0].note, /Inactive/);
});
