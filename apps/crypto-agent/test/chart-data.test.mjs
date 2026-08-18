import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeKlineRows } from '../src/chart-data.ts';

test('merges older pages and live candles without sorting or duplicates', () => {
  const current = [[3, 'old-3'], [4, 'old-4']];
  assert.deepEqual(mergeKlineRows(current, [[1, 'one'], [2, 'two'], [3, 'new-3']]), [[1, 'one'], [2, 'two'], [3, 'new-3'], [4, 'old-4']]);
  assert.deepEqual(mergeKlineRows(current, [[4, 'new-4']]), [[3, 'old-3'], [4, 'new-4']]);
  assert.deepEqual(mergeKlineRows(current, [[5, 'five']]), [[3, 'old-3'], [4, 'old-4'], [5, 'five']]);
});
