export type KlineRow = Array<string | number>;

export function klineWindow<T>(rows: T[], offset: number, limit = 120) {
  const end = rows.length - Math.min(Math.max(0, rows.length - limit), Math.max(0, offset));
  return rows.slice(Math.max(0, end - limit), end);
}

export function anchoredTickIndices(times: number[], start: number, end: number, anchorTime: number, spacing: number) {
  if (!times.length || spacing <= 0 || end < start) return [];
  const anchor = times.indexOf(anchorTime);
  if (anchor < 0) return [];
  const first = Math.ceil((start - anchor) / spacing);
  const last = Math.floor((end - anchor) / spacing);
  return Array.from({ length: last - first + 1 }, (_, index) => anchor + (first + index) * spacing);
}

export function appendedPointCount(times: number[], previousLastTime: number | null) {
  if (previousLastTime === null) return 0;
  const previousLast = times.indexOf(previousLastTime);
  return previousLast < 0 ? 0 : times.length - previousLast - 1;
}

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

export function mergeTradeIntoSecondRows(current: KlineRow[], timestamp: number, price: number, quantity: number, limit = 240) {
  const time = Math.floor(timestamp / 1_000) * 1_000;
  const last = current.at(-1);
  if (last && Number(last[0]) > time) return current;
  if (!last || Number(last[0]) !== time) return [...current, [time, price, price, price, price, quantity, time + 999, price * quantity]].slice(-limit);
  const next = [...current];
  next[next.length - 1] = [time, last[1], Math.max(Number(last[2]), price), Math.min(Number(last[3]), price), price, Number(last[5]) + quantity, time + 999, Number(last[7]) + price * quantity];
  return next;
}
