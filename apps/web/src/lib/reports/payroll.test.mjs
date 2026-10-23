import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidPayrollDate, summarizePayrollEntries } from './payroll.ts';

test('pay period dates reject impossible calendar days', () => {
  assert.equal(isValidPayrollDate('2026-02-28'), true);
  assert.equal(isValidPayrollDate('2024-02-29'), true);
  assert.equal(isValidPayrollDate('2026-02-30'), false);
  assert.equal(isValidPayrollDate('2026-13-01'), false);
});

test('keeps same-name educators separate and totals each staff member', () => {
  const entry = (id, status = 'approved') => ({
    staff_member_id: id,
    clocked_in_at: '2026-10-12T09:00:00Z',
    clocked_out_at: '2026-10-12T10:00:00Z',
    break_minutes: 0,
    status,
    staff: { profile: { full_name: 'Alex Lee' } },
  });
  const summary = summarizePayrollEntries([entry('one'), entry('two'), entry('one')]);
  assert.equal(summary.size, 2);
  assert.deepEqual(summary.get('one'), { name: 'Alex Lee', minutes: 120, entries: 2, approved: true });
  assert.deepEqual(summary.get('two'), { name: 'Alex Lee', minutes: 60, entries: 1, approved: true });
});

test('does not count open time as payable or mark it approved', () => {
  const summary = summarizePayrollEntries([{
    staff_member_id: 'one',
    clocked_in_at: '2026-10-12T09:00:00Z',
    clocked_out_at: null,
    break_minutes: 0,
    status: 'open',
    staff: { profile: { full_name: 'Alex Lee' } },
  }]);
  assert.equal(summary.get('one')?.minutes, 0);
  assert.equal(summary.get('one')?.approved, false);
});
