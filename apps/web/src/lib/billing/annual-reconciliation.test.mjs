import assert from 'node:assert/strict';
import test from 'node:test';
import { annualReconciliationIssues } from './annual-reconciliation.ts';

const base = () => ({
  providerDetailsRecorded: true,
  reviewYear: 2025,
  eventCount: 1,
  unassignedPaymentCount: 0,
  missingPaymentDates: 0,
  missingRefundDates: 0,
  nonCadPaymentCount: 0,
  unreviewableChildEvents: 0,
  nonCadManualCount: 0,
  unresolvedTimingCount: 0,
  lines: [{
    classification: 'care_service_candidate', stale: false,
    serviceStartOn: '2025-01-01', serviceEndOn: '2025-12-31',
    serviceEvidenceNote: 'Signed enrollment contract',
  }],
  events: [{
    amountCents: 10000, linesMatchTotal: true, allReviewed: true,
    originalReceiptAllocated: true, kind: 'received',
    lines: [{ allocatedCents: 10000 }],
  }],
  adjustments: [],
});

test('reconciled evidence has no operational issues but is not approval', () => {
  assert.deepEqual(annualReconciliationIssues(base()), []);
});

test('missing dates, stale line, unallocated payment and possible credit are distinct issues', () => {
  const input = base();
  input.providerDetailsRecorded = false;
  input.lines[0].stale = true;
  input.lines[0].serviceStartOn = '';
  input.events[0].lines[0].allocatedCents = 0;
  input.adjustments.push({ disposition: 'possible_invoice_relation', stale: false });
  const ids = annualReconciliationIssues(input).map((issue) => issue.id);
  assert.deepEqual(ids, ['provider', 'lines', 'allocations', 'adjustments']);
});

test('candidate with service in another year needs manual year review', () => {
  const input = base();
  input.lines[0].serviceStartOn = '2026-01-01';
  input.lines[0].serviceEndOn = '2026-01-31';
  assert.deepEqual(annualReconciliationIssues(input).map((issue) => issue.id), ['cross-year']);
});

test('zero activity and excluded-only lines do not appear complete', () => {
  const input = base();
  input.eventCount = 0;
  input.events = [];
  assert.deepEqual(annualReconciliationIssues(input).map((issue) => issue.id), ['no-activity']);
  input.eventCount = 1;
  input.lines[0].classification = 'exclude';
  assert.deepEqual(annualReconciliationIssues(input).map((issue) => issue.id), ['no-candidates']);
});

test('undated records, non-CAD items and inactive invoice events stay visible', () => {
  const input = base();
  input.missingPaymentDates = 1;
  input.missingRefundDates = 1;
  input.nonCadManualCount = 2;
  input.unreviewableChildEvents = 1;
  const issues = annualReconciliationIssues(input);
  assert.deepEqual(issues.map((issue) => [issue.id, issue.count]), [
    ['undated', 2], ['currency', 2], ['unreviewable', 1],
  ]);
});

test('unexplained or stale invoice timing remains a separate open check', () => {
  const input = base();
  input.unresolvedTimingCount = 2;
  assert.deepEqual(annualReconciliationIssues(input).map((issue) => [issue.id, issue.count]), [
    ['timing', 2],
  ]);
});
