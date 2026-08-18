export class NewsService {
  constructor({ baseUrl = '', apiKey = '', pollMs = 15_000, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.apiKey = apiKey; this.pollMs = pollMs; this.fetchImpl = fetchImpl;
    this.items = new Map(); this.listeners = new Set(); this.timer = null; this.loaded = false; this.lastDigestAt = 0;
  }
  get configured() { return Boolean(this.baseUrl && this.apiKey); }
  async request({ limit = 30, before = '' } = {}) {
    if (!this.configured) throw new Error('The custom API gateway is not configured.');
    const query = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) });
    const response = await this.fetchImpl(`${this.baseUrl}/v1/news/archive?${query}`, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`News gateway returned ${response.status}.`);
    return response.json();
  }
  async load() { await this.poll(); }
  async history(options = {}) { try { return await this.request(options); } catch { return { items: this.recent(options.limit), nextCursor: null }; } }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) { try { listener(event); } catch { /* one subscriber must not stop others */ } } }
  async poll() {
    let rows;
    try { rows = (await this.request({ limit: 100 })).items || []; } catch { return []; }
    const fresh = rows.filter((item) => item?.id && !this.items.has(item.id));
    for (const item of rows) if (item?.id) this.items.set(item.id, item);
    if (this.items.size > 500) this.items = new Map(this.recent(500).map((item) => [item.id, item]));
    if (this.loaded) for (const item of fresh) { this.emit({ type: 'item', item }); if (item.urgency === 'breaking') this.emit({ type: 'breaking', item }); }
    this.loaded = true;
    return fresh;
  }
  start() { if (this.timer || !this.configured) return; this.timer = setInterval(() => void this.poll(), this.pollMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  recent(limit = 30) { return [...this.items.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit); }
  async twoHourDigest() {
    const now = Date.now(); const since = this.lastDigestAt || now - 2 * 60 * 60 * 1000;
    const items = this.recent(100).filter((item) => { const published = Date.parse(item.publishedAt); return published > since && published <= now; });
    this.lastDigestAt = now;
    return items;
  }
}
