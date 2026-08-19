export class MarketEventService {
  constructor({ baseUrl = '', apiKey = '', pollMs = 3_000, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.apiKey = apiKey; this.pollMs = pollMs; this.fetchImpl = fetchImpl;
    this.items = new Map(); this.listeners = new Set(); this.timer = null; this.loaded = false;
  }
  get configured() { return Boolean(this.baseUrl && this.apiKey); }
  async request({ limit = 30, before = '' } = {}) {
    if (!this.configured) throw new Error('The market event gateway is not configured.');
    const query = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) });
    const response = await this.fetchImpl(`${this.baseUrl}/v1/market/coinm/events?${query}`, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Market event gateway returned ${response.status}.`);
    return response.json();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) { try { listener(event); } catch { /* subscriber failures are isolated */ } } }
  async poll() {
    let rows;
    try { rows = (await this.request({ limit: 100 })).items || []; } catch { return []; }
    const fresh = rows.filter((item) => item?.id && !this.items.has(item.id));
    for (const item of rows) if (item?.id) this.items.set(item.id, item);
    if (this.items.size > 500) this.items = new Map(this.recent(500).map((item) => [item.id, item]));
    if (this.loaded) for (const item of fresh) this.emit({ type: item.severity === 'breaking' ? 'breaking' : 'item', item });
    this.loaded = true;
    return fresh;
  }
  async load() { await this.poll(); }
  start() { if (this.timer || !this.configured) return; this.timer = setInterval(() => void this.poll(), this.pollMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  recent(limit = 30) { return [...this.items.values()].sort((a, b) => b.observedAt - a.observedAt).slice(0, limit); }
}
