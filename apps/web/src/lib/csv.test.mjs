import assert from 'node:assert/strict';
import test from 'node:test';
import { csvCell, csvRows } from './csv.ts';

test('neutralizes formula-like and control-prefixed text', () => {
  for (const value of ['=1+2', '+SUM(A1:A2)', '-HYPERLINK("x")', '@SUM(1)', '  =1+2', '＝1+2', '\t=1+2']) {
    assert.ok(csvCell(value).startsWith('"\t'), value);
  }
});

test('keeps ordinary numeric cells useful', () => {
  assert.equal(csvCell('123.45'), '123.45');
  assert.equal(csvCell('-42.50'), '-42.50');
  assert.equal(csvCell('+1-555-0100'), '"\t+1-555-0100"');
});

test('quotes delimiters and embedded quotes without creating extra cells', () => {
  assert.equal(csvCell('Alex, "Room A"'), '"Alex, ""Room A"""');
  assert.equal(csvCell('name",=1+2'), '"name"",=1+2"');
  assert.equal(csvRows([['Name', 'Value'], ['Alex', '=1+2']]), 'Name,Value\r\nAlex,"\t=1+2"');
});
