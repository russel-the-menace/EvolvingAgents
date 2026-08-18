import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const URGENT = /hack|exploit|breach|bankrupt|insolv|halt|outage|delist|listing|liquidat|etf approved|sec lawsuit|审查|黑客|攻击|漏洞|暂停|下架|上线|清算|破产|暴跌|暴涨/i;

function text(value = '') { return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim(); }
function tag(block, name) { return text(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1]); }
function link(block) { return text(block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1] || tag(block, 'link') || tag(block, 'guid')); }
function hash(value) { return createHash('sha256').update(value).digest('hex').slice(0, 20); }

function jsonItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['articles', 'items', 'data', 'results', 'news']) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

export function parseNewsJson(payload, source) {
  return jsonItems(payload).map((item) => {
    const title = text(item.title || item.headline || item.text || item.content || item.description);
    const rawUrl = text(item.url || item.link || item.news_url || item.sourceUrl || item.tweetUrl);
    const id = text(item.id || item.tweetId || item.statusId);
    const url = rawUrl || (source.startsWith('X · ') && id ? `https://x.com/i/web/status/${id}` : id);
    const summary = text(item.summary || item.description || item.text || item.content || title);
    const publishedAt = item.publishedAt || item.published_at || item.createdAt || item.created_at || item.timestamp || item.ts || item.date;
    const timestamp = typeof publishedAt === 'number' ? (publishedAt < 1e12 ? publishedAt * 1000 : publishedAt) : Date.parse(publishedAt || '') || Date.now();
    const publisher = text(item.source || item.source_name || item.publisher || item.author?.name || source);
    return { id: hash(`${url}|${title}`), title: title.slice(0, 500), url, source: publisher || source, summary: summary.slice(0, 500), publishedAt: new Date(timestamp).toISOString(), urgency: URGENT.test(`${title} ${summary}`) ? 'breaking' : 'normal' };
  }).filter((item) => item.title && item.url);
}

export function parseBinanceAnnouncements(payload, source = 'Binance') {
  const articles = payload?.data?.catalogs?.flatMap((catalog) => catalog.articles || []) || [];
  return parseNewsJson({ items: articles.map((item) => ({ title: item.title, id: item.code || item.id, url: item.url || `https://www.binance.com/en/support/announcement/${item.code || item.id}`, publishedAt: item.releaseDate })) }, source);
}

export function parseOkxAnnouncements(payload, source = 'OKX') {
  const details = payload?.data?.flatMap((group) => group.details || []) || [];
  return parseNewsJson({ items: details.map((item) => ({ title: item.title, url: item.url, publishedAt: item.pTime })) }, source);
}

export function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].map((match) => match[1]);
  return blocks.map((block) => {
    const title = tag(block, 'title'); const url = link(block); const publishedAt = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    const summary = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content');
    const timestamp = Date.parse(publishedAt) || Date.now();
    return { id: hash(`${url}|${title}`), title, url, source, summary: summary.slice(0, 500), publishedAt: new Date(timestamp).toISOString(), urgency: URGENT.test(`${title} ${summary}`) ? 'breaking' : 'normal' };
  }).filter((item) => item.title && item.url);
}

export class NewsService {
  constructor({ feedUrls = [], apiSources = [], stateFile = '', pollMs = 300_000, fetchImpl = fetch, learnItem, archiveUrl = '', archiveKey = '' } = {}) {
    this.feedUrls = feedUrls; this.apiSources = apiSources; this.stateFile = stateFile; this.pollMs = pollMs; this.fetchImpl = fetchImpl; this.learnItem = learnItem; this.archiveUrl = archiveUrl.replace(/\/$/, ''); this.archiveKey = archiveKey; this.items = new Map(); this.listeners = new Set(); this.timer = null; this.lastDigestAt = 0; this.startupDate = '';
  }
  async load() { if (this.stateFile) try { const saved = JSON.parse(await readFile(this.stateFile, 'utf8')); for (const item of saved.items || []) this.items.set(item.id, item); this.startupDate = saved.startupDate || ''; this.lastDigestAt = saved.lastDigestAt || 0; } catch { /* first run */ } if (this.items.size) await this.archive([...this.items.values()]); }
  async save() { if (!this.stateFile) return; await mkdir(dirname(this.stateFile), { recursive: true }); await writeFile(this.stateFile, JSON.stringify({ items: [...this.items.values()].slice(-500), startupDate: this.startupDate, lastDigestAt: this.lastDigestAt })); }
  async archive(items) { if (!this.archiveUrl || !this.archiveKey || !items.length) return; try { await this.fetchImpl(`${this.archiveUrl}/v1/news/archive`, { method: 'POST', headers: { Authorization: `Bearer ${this.archiveKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items }), signal: AbortSignal.timeout(12_000) }); } catch { /* remote archive must not stop collection */ } }
  async history({ limit = 30, before = '' } = {}) { if (!this.archiveUrl || !this.archiveKey) return { items: this.recent(limit), nextCursor: null }; try { const query = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) }); const response = await this.fetchImpl(`${this.archiveUrl}/v1/news/archive?${query}`, { headers: { Authorization: `Bearer ${this.archiveKey}` }, signal: AbortSignal.timeout(12_000) }); if (response.ok) return response.json(); } catch { /* fall back to hot cache */ } return { items: this.recent(limit), nextCursor: null }; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) { try { listener(event); } catch { /* one subscriber must not stop the feed */ } } }
  async poll() {
    const fresh = [];
    for (const url of this.feedUrls) {
      try { const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': 'CryptoAgent/0.1 RSS reader' } }); if (!response.ok) continue; const source = new URL(url).hostname; for (const item of parseFeed(await response.text(), source)) if (!this.items.has(item.id)) { this.items.set(item.id, item); fresh.push(item); } } catch { /* one source failing must not stop other feeds */ }
    }
    for (const source of this.apiSources) {
      try {
        const response = await this.fetchImpl(source.url, { method: source.method || 'GET', headers: { Accept: 'application/json', 'User-Agent': 'CryptoAgent/0.1 news connector', ...(source.headers || {}) }, body: source.body ? JSON.stringify(source.body) : undefined, signal: AbortSignal.timeout(12_000) });
        if (!response.ok) continue;
        const payload = await response.json();
        const items = source.parse ? source.parse(payload) : parseNewsJson(payload, source.name);
        for (const item of items) if (!this.items.has(item.id)) { this.items.set(item.id, item); fresh.push(item); }
      } catch { /* optional API sources must not stop RSS collection */ }
    }
    if (this.items.size > 500) this.items = new Map([...this.items.entries()].slice(-500));
    for (const item of fresh) {
      if (this.learnItem) void Promise.resolve(this.learnItem(item)).catch(() => {});
      this.emit({ type: 'item', item });
      if (item.urgency === 'breaking') this.emit({ type: 'breaking', item });
    }
    if (fresh.length) void this.archive(fresh);
    if (fresh.length) await this.save();
    return fresh;
  }
  start() { if (this.timer || (!this.feedUrls.length && !this.apiSources.length)) return; void this.poll(); this.timer = setInterval(() => void this.poll(), this.pollMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  recent(limit = 30) { return [...this.items.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit); }
  async startupDigest() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (this.startupDate === today) return [];
    this.startupDate = today;
    await this.save();
    return this.recent(10);
  }
  async twoHourDigest() {
    const now = Date.now();
    // Keep a cursor instead of a rolling time filter so a digest never repeats after a restart.
    const since = this.lastDigestAt || now - 2 * 60 * 60 * 1000;
    const items = this.recent(100).filter((item) => { const published = Date.parse(item.publishedAt); return published > since && published <= now; });
    this.lastDigestAt = now;
    await this.save();
    return items;
  }
}
