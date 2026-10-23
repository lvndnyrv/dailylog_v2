import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllReportRows } from './pagination.ts';

test('collects more than the default 1,000-row response cap', async () => {
  const source = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const ranges = [];
  const result = await fetchAllReportRows((from, to) => {
    ranges.push([from, to]);
    return Promise.resolve({ data: source.slice(from, to + 1), error: null });
  });
  assert.equal(result.data?.length, 1201);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
  assert.deepEqual(result.data?.map(({ id }) => id), source.map(({ id }) => id));
});

test('checks one more page when a full page ends the result', async () => {
  let calls = 0;
  const result = await fetchAllReportRows((from, to) => {
    calls += 1;
    return Promise.resolve({ data: Array.from({ length: 500 }, (_, i) => i).slice(from, to + 1), error: null });
  });
  assert.equal(result.data?.length, 500);
  assert.equal(calls, 2);
});

test('returns a failed page as an error rather than a partial report', async () => {
  const failure = new Error('page unavailable');
  const result = await fetchAllReportRows((from) => Promise.resolve(from === 0
    ? { data: Array.from({ length: 500 }, (_, i) => i), error: null }
    : { data: null, error: failure }));
  assert.equal(result.data, null);
  assert.equal(result.error, failure);
});
