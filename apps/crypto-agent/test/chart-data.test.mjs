import test from 'node:test';
import assert from 'node:assert/strict';
import { klineWindow, mergeKlineRows, mergeTradeIntoSecondRows } from '../src/chart-data.ts';

test('merges older pages and live candles without sorting or duplicates', () => {
  const current = [[3, 'old-3'], [4, 'old-4']];
  assert.deepEqual(mergeKlineRows(current, [[1, 'one'], [2, 'two'], [3, 'new-3']]), [[1, 'one'], [2, 'two'], [3, 'new-3'], [4, 'old-4']]);
  assert.deepEqual(mergeKlineRows(current, [[4, 'new-4']]), [[3, 'old-3'], [4, 'new-4']]);
  assert.deepEqual(mergeKlineRows(current, [[5, 'five']]), [[3, 'old-3'], [4, 'old-4'], [5, 'five']]);
});

test('aggregates trades into bounded one-second OHLCV rows', () => {
  let rows = mergeTradeIntoSecondRows([], 1_100, 100, 2);
  rows = mergeTradeIntoSecondRows(rows, 1_900, 105, 3);
  rows = mergeTradeIntoSecondRows(rows, 2_100, 103, 1);
  assert.deepEqual(rows, [[1_000, 100, 105, 100, 105, 5, 1_999, 515], [2_000, 103, 103, 103, 103, 1, 2_999, 103]]);
  assert.equal(mergeTradeIntoSecondRows(rows, 900, 99, 1), rows);
});

test('moves the visible K-line window left and right without crossing its bounds', () => {
  const rows = Array.from({ length: 240 }, (_, index) => index);
  assert.deepEqual(klineWindow(rows, 0, 120), rows.slice(120));
  assert.deepEqual(klineWindow(rows, 60, 120), rows.slice(60, 180));
  assert.deepEqual(klineWindow(rows, 999, 120), rows.slice(0, 120));
});
