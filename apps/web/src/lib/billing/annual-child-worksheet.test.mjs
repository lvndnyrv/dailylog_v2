import assert from 'node:assert/strict';
import test from 'node:test';
import { annualChildWorksheets } from './annual-child-worksheet.ts';

const rows = [{ id: 'one', name: 'One Child', received: 10000, refunded: 2000 }];
const lines = [
  { id: 'care', classification: 'care_service_candidate', stale: false,
    serviceStartOn: '2025-01-01', serviceEndOn: '2025-01-31', serviceEvidenceNote: 'Signed contract' },
  { id: 'fee', classification: 'exclude', stale: false,
    serviceStartOn: '', serviceEndOn: '', serviceEvidenceNote: '' },
];
const events = [
  { childId: 'one', kind: 'received', amountCents: 10000, linesMatchTotal: true,
    allReviewed: true, originalReceiptAllocated: true,
    lines: [{ id: 'care', allocatedCents: 8000 }, { id: 'fee', allocatedCents: 2000 }] },
  { childId: 'one', kind: 'refunded', amountCents: 2000, linesMatchTotal: true,
    allReviewed: true, originalReceiptAllocated: true,
    lines: [{ id: 'care', allocatedCents: 2000 }, { id: 'fee', allocatedCents: 0 }] },
];

test('keeps raw activity separate from reviewed candidate and excluded allocations', () => {
  assert.deepEqual(annualChildWorksheets(2025, rows, lines, events), [{
    ...rows[0], candidateCents: 6000, excludedCents: 2000, gaps: [],
  }]);
});

test('withholds allocation subtotals when source activity is not fully reviewable', () => {
  const result = annualChildWorksheets(2025, rows, lines, events.slice(0, 1))[0];
  assert.equal(result.candidateCents, null);
  assert.match(result.gaps.join(' '), /does not match/);
});

test('withholds subtotal for stale, missing, cross-year or unallocated evidence', () => {
  for (const changed of [
    { lines: [{ ...lines[0], stale: true }, lines[1]], events },
    { lines: [{ ...lines[0], serviceEvidenceNote: '' }, lines[1]], events },
    { lines: [{ ...lines[0], serviceEndOn: '2026-01-01' }, lines[1]], events },
    { lines, events: [{ ...events[0], lines: [{ id: 'care', allocatedCents: 1 }] }, events[1]] },
  ]) {
    const result = annualChildWorksheets(2025, rows, changed.lines, changed.events)[0];
    assert.equal(result.candidateCents, null);
    assert.ok(result.gaps.length);
  }
});
