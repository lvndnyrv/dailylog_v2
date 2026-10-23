import assert from 'node:assert/strict';
import test from 'node:test';
import { listInvoices, listInvoicesByIds } from './billing.ts';

function invoice(index) {
  return { id: `invoice-${String(index).padStart(4, '0')}`, issued_on: '2026-10-01' };
}

function fakeClient(rows, failAt = null) {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'invoices');
      const query = { ids: null, order: [] };
      calls.push(query);
      return {
        select() { return this; },
        in(column, ids) {
          assert.equal(column, 'id');
          query.ids = ids;
          return this;
        },
        order(column, options) {
          query.order.push([column, options.ascending]);
          return this;
        },
        async range(from, to) {
          query.range = [from, to];
          if (failAt === calls.length) return { data: null, error: { message: 'Later page failed' } };
          const filtered = query.ids ? rows.filter((row) => query.ids.includes(row.id)) : rows;
          return { data: filtered.slice(from, to + 1), error: null };
        },
      };
    },
  };
  return { client, calls };
}

test('full invoice list continues past the database row cap with stable ordering', async () => {
  const rows = Array.from({ length: 1201 }, (_, index) => invoice(1201 - index));
  const { client, calls } = fakeClient(rows);
  assert.deepEqual(await listInvoices(client), rows);
  assert.deepEqual(calls.map((call) => call.range), [[0, 499], [500, 999], [1000, 1499]]);
  assert.ok(calls.every((call) => JSON.stringify(call.order) ===
    JSON.stringify([['issued_on', false], ['id', false]])));
});

test('an exact full page fetches the next page and never reports a partial success', async () => {
  const rows = Array.from({ length: 500 }, (_, index) => invoice(500 - index));
  const { client, calls } = fakeClient(rows);
  assert.equal((await listInvoices(client)).length, 500);
  assert.equal(calls.length, 2);
  await assert.rejects(listInvoices(fakeClient(rows, 2).client), { message: 'Later page failed' });
});

test('dashboard lookup fetches only requested invoice IDs in bounded batches', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => invoice(201 - index));
  const ids = rows.map((row) => row.id);
  const { client, calls } = fakeClient(rows);
  assert.deepEqual(await listInvoicesByIds(client, [...ids, ids[0]]), rows);
  assert.deepEqual(calls.map((call) => call.ids.length), [100, 100, 1]);
  assert.deepEqual(await listInvoicesByIds(fakeClient(rows).client, []), []);
});
