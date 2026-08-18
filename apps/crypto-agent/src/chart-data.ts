export type KlineRow = Array<string | number>;

export function mergeKlineRows(current: KlineRow[], incoming: KlineRow[]) {
  // ponytail: History stays in memory; move pages to IndexedDB if multi-year minute browsing becomes a normal workflow.
  if (!current.length) return [...incoming].sort((a, b) => Number(a[0]) - Number(b[0]));
  if (incoming.length === 1) {
    const row = incoming[0]; const time = Number(row[0]); let low = 0; let high = current.length;
    while (low < high) { const middle = (low + high) >> 1; if (Number(current[middle][0]) < time) low = middle + 1; else high = middle; }
    const next = [...current]; if (Number(next[low]?.[0]) === time) next[low] = row; else next.splice(low, 0, row); return next;
  }
  const next: KlineRow[] = []; let left = 0; let right = 0;
  while (left < current.length || right < incoming.length) {
    const currentTime = left < current.length ? Number(current[left][0]) : Infinity;
    const incomingTime = right < incoming.length ? Number(incoming[right][0]) : Infinity;
    if (currentTime < incomingTime) next.push(current[left++]);
    else if (incomingTime < currentTime) next.push(incoming[right++]);
    else { next.push(incoming[right++]); left += 1; }
  }
  return next;
}
