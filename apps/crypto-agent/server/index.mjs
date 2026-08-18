import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createModelGateway } from '@evolving-agents/model-gateway';
import { parseModelJson } from '@evolving-agents/learning-engine';
import { BinanceApiError, createBinanceMarginClient, createBinanceSpotClient, createBinanceUsdMClient } from '../src/binance.mjs';
import { auditBinancePermissions } from '../src/permissions.mjs';
import { fallbackIntent, inferProduct, multiProductTradePrompt, normalizeOrderIntent, tradePrompt, validateOrder } from '../src/trading.mjs';
import { NewsService } from '../src/news.mjs';
import { createNewsLearner } from '../src/news-learning.mjs';
import { EmergencyPolicy } from '../src/emergency-policy.mjs';
import { analysisMessages, isTradeCommand, validImageDataUrl } from './market-context.mjs';
import { requestedOrderBookRange } from './order-book-context.mjs';

const port = Number(process.env.CRYPTO_AGENT_API_PORT || 5451);
const environment = process.env.BINANCE_ENV === 'live' ? 'live' : 'testnet';
const liveTradingEnabled = environment === 'live' && process.env.BINANCE_LIVE_TRADING === 'true';
const symbolConfig = (process.env.BINANCE_SYMBOLS || 'BTCUSDT,ETHUSDT').trim();
const allowedSymbols = symbolConfig === '*' ? null : symbolConfig.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
const externalNewsEnabled = process.env.NEWS_EXTERNAL_SOURCES !== 'off';
const remoteNewsOnly = process.env.NEWS_REMOTE_ONLY === 'true';
const socialKeywords = (process.env.NEWS_SOCIAL_KEYWORDS || '').split(',').map((item) => item.trim()).filter(Boolean);
const maxOrderUsdt = Number(process.env.MAX_ORDER_USDT || 100);
const configured = Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY);
const gatewayProvider = process.env.GATEWAY_PROVIDER || 'openai';
const gatewayBaseUrl = (process.env.GATEWAY_BASE_URL || process.env.NEWS_ARCHIVE_BASE_URL || '').replace(/\/$/, '');
const gatewayApiKey = process.env.GATEWAY_API_KEY || process.env.NEWS_ARCHIVE_API_KEY || '';
const marketDataBase = (process.env.MARKET_DATA_BASE_URL || process.env.GATEWAY_BASE_URL || process.env.NEWS_ARCHIVE_BASE_URL || '').replace(/\/$/, '');
const marketDataKey = process.env.MARKET_DATA_API_KEY || process.env.GATEWAY_API_KEY || process.env.NEWS_ARCHIVE_API_KEY || '';
const modelOptions = ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'];
const reasoningOptions = ['low', 'medium', 'high', 'xhigh', 'max'];
const defaultModel = modelOptions.includes(process.env.GATEWAY_MODEL) ? process.env.GATEWAY_MODEL : 'gpt-5.6-luna';
const defaultReasoning = reasoningOptions.includes(process.env.GATEWAY_REASONING_EFFORT) ? process.env.GATEWAY_REASONING_EFFORT : 'medium';
const binance = createBinanceSpotClient({ apiKey: process.env.BINANCE_API_KEY, secretKey: process.env.BINANCE_SECRET_KEY, environment });
const futures = createBinanceUsdMClient({ apiKey: process.env.BINANCE_API_KEY, secretKey: process.env.BINANCE_SECRET_KEY, environment });
const margin = createBinanceMarginClient({ apiKey: process.env.BINANCE_API_KEY, secretKey: process.env.BINANCE_SECRET_KEY, environment });
const gateway = gatewayBaseUrl && gatewayApiKey
  ? createModelGateway({ baseUrl: gatewayBaseUrl, apiKey: gatewayApiKey, provider: gatewayProvider, model: defaultModel, reasoningEffort: defaultReasoning })
  : null;
const drafts = new Map();
const futuresDrafts = new Map();
const marginDrafts = new Map();
const marginActionDrafts = new Map();
const symbolAllowed = (symbol) => !allowedSymbols || allowedSymbols.includes(symbol);
const defaultNewsState = process.platform === 'darwin' && process.env.HOME ? `${process.env.HOME}/Library/Application Support/CryptoAgent/news-state.json` : '';
const defaultNewsKnowledge = process.platform === 'darwin' && process.env.HOME ? `${process.env.HOME}/Library/Application Support/CryptoAgent/news-knowledge.sqlite` : '';
const newsLearner = createNewsLearner(process.env.NEWS_LEARNING_DB_FILE || defaultNewsKnowledge);
const defaultNewsFeeds = [
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://cointelegraph.com/rss',
  'https://decrypt.co/feed',
  'https://bitcoinmagazine.com/.rss/full/',
  'https://blog.kraken.com/feed'
];
const defaultCexFeeds = [
  'https://rsshub.app/binance/announcement',
  'https://rsshub.app/okx/announcement',
  'https://rsshub.app/bybit/announcement'
];
const feedUrls = remoteNewsOnly ? [] : [...(process.env.NEWS_RSS_URLS || defaultNewsFeeds.join(',')).split(','), ...(process.env.NEWS_CEX_RSS_URLS || defaultCexFeeds.join(',')).split(',')].map((item) => item.trim()).filter(Boolean);
const apiSources = externalNewsEnabled && !remoteNewsOnly ? [{ name: 'cryptocurrency.cv', url: process.env.CRYPTO_NEWS_URL || 'https://cryptocurrency.cv/api/news?limit=30' }] : [];
if (process.env.OPENNEWS_TOKEN) {
  for (const keyword of socialKeywords) {
    apiSources.push({ name: `X · ${keyword}`, url: 'https://ai.6551.io/open/twitter_search', method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENNEWS_TOKEN}`, 'Content-Type': 'application/json' }, body: { keywords: keyword, maxResults: 20, product: 'Latest', excludeReplies: true } });
    apiSources.push({ name: `OpenNews · ${keyword}`, url: 'https://ai.6551.io/open/news_search', method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENNEWS_TOKEN}`, 'Content-Type': 'application/json' }, body: { q: keyword, limit: 20, page: 1 } });
  }
}
const news = new NewsService({ feedUrls, apiSources, stateFile: process.env.NEWS_STATE_FILE || defaultNewsState, pollMs: Number(process.env.NEWS_POLL_MS || 300_000), learnItem: newsLearner?.learn, archiveUrl: process.env.NEWS_ARCHIVE_BASE_URL || process.env.GATEWAY_BASE_URL, archiveKey: process.env.NEWS_ARCHIVE_API_KEY || process.env.GATEWAY_API_KEY });
const newsClients = new Set();
const emergency = new EmergencyPolicy({ budgetFraction: Number(process.env.EMERGENCY_BUDGET_FRACTION || 0.2), grantMs: Number(process.env.EMERGENCY_GRANT_MS || 30 * 60_000), cooldownMs: Number(process.env.EMERGENCY_COOLDOWN_MS || 15 * 60_000) });
void news.load().then(() => news.start());
news.subscribe((event) => {
  for (const response of newsClients) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  if (event.type === 'breaking' && configured) void accountSnapshot().then(({ balances }) => {
    const equity = Number(balances.find((balance) => balance.asset === 'USDT')?.free || 0);
    if (!(equity > 0)) return;
    const pending = emergency.trigger({ item: event.item, equity });
    for (const response of newsClients) response.write(`event: emergency\ndata: ${JSON.stringify(pending)}\n\n`);
  }).catch(() => {});
});
const digestTimer = setInterval(async () => { const items = await news.twoHourDigest(); if (!items.length) return; const event = { type: 'digest', items }; for (const response of newsClients) response.write(`event: digest\ndata: ${JSON.stringify(event)}\n\n`); }, 2 * 60 * 60 * 1000);
digestTimer.unref?.();

function sendJson(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); }
async function body(request, maxLength = 50_000) {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > maxLength) throw new Error('Request body is too large.'); }
  return raw ? JSON.parse(raw) : {};
}
function publicError(error) {
  if (error instanceof BinanceApiError) return { status: error.status || 502, message: error.executionUnknown ? `${error.message} Order status is unknown; check Binance before retrying.` : error.message };
  return { status: 400, message: error instanceof Error ? error.message : 'Request failed.' };
}
function cleanDrafts() {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [id, draft] of drafts) if (draft.createdAt < cutoff) drafts.delete(id);
}

async function accountSnapshot() {
  const account = await binance.account();
  return { canTrade: account.canTrade, balances: account.balances || [] };
}

let assetCache = null;
let assetCacheAt = 0;
async function assetSnapshot() {
  if (!configured) return { configured: false, spot: null, funding: null, earn: null, futures: null, wallets: null, prices: { USDT: 1 }, errors: ['Configure Binance credentials before reading assets.'] };
  if (assetCache && Date.now() - assetCacheAt < 10_000) return assetCache;
  const [spot, funding, earn, futuresAccount, wallets, prices] = await Promise.allSettled([binance.account(), binance.fundingAsset(), binance.earnFlexible(), futures.assetAccount(), binance.walletBalance('USDT'), binance.prices()]);
  const result = { configured: true, spot: null, funding: null, earn: null, futures: null, wallets: null, prices: { USDT: 1 }, errors: [] };
  for (const [key, entry] of [['spot', spot], ['funding', funding], ['earn', earn], ['futures', futuresAccount], ['wallets', wallets]]) {
    if (entry.status === 'fulfilled') result[key] = entry.value;
    else result.errors.push(`${key}: ${entry.reason instanceof Error ? entry.reason.message : 'Binance endpoint unavailable'}`);
  }
  if (prices.status === 'fulfilled') {
    const assets = new Set([
      ...(result.spot?.balances || []).map((item) => item.asset),
      ...(result.funding || []).map((item) => item.asset),
      ...(result.earn?.rows || []).map((item) => item.asset),
      ...(result.futures?.assets || []).map((item) => item.asset),
    ]);
    for (const item of prices.value || []) {
      const asset = item.symbol?.endsWith('USDT') ? item.symbol.slice(0, -4) : '';
      const price = Number(item.price);
      if (asset && assets.has(asset) && Number.isFinite(price)) result.prices[asset] = price;
    }
  } else result.errors.push(`prices: ${prices.reason instanceof Error ? prices.reason.message : 'Binance endpoint unavailable'}`);
  assetCache = result;
  assetCacheAt = Date.now();
  return result;
}

async function coinMMarket(symbol, interval, endTime) {
  const base = environment === 'testnet' ? 'https://testnet.binancefuture.com' : 'https://dapi.binance.com';
  const get = async (path, params) => {
    const response = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(10_000) });
    const result = await response.json();
    if (!response.ok) throw new BinanceApiError(result.msg || `Binance Coin-M request failed (${response.status}).`, { status: response.status, code: result.code });
    return result;
  };
  const klineParams = { symbol, interval, limit: '240', ...(endTime ? { endTime: String(endTime) } : {}) };
  if (endTime) return { symbol, interval, klines: await get('/dapi/v1/klines', klineParams), depth: { bids: [], asks: [] }, premium: { markPrice: '0', indexPrice: '0' }, partial: true };
  const [klines, depth, premium] = await Promise.all([
    get('/dapi/v1/klines', klineParams),
    get('/dapi/v1/depth', { symbol, limit: '1000' }),
    get('/dapi/v1/premiumIndex', { symbol }),
  ]);
  return { symbol, interval, klines, depth, premium: Array.isArray(premium) ? premium[0] : premium };
}

async function usdMMarket(symbol, interval, endTime) {
  const base = environment === 'testnet' ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
  const get = async (path, params) => {
    const response = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(10_000) });
    const result = await response.json();
    if (!response.ok) throw new BinanceApiError(result.msg || `Binance USD-M request failed (${response.status}).`, { status: response.status, code: result.code });
    return result;
  };
  const klineParams = { symbol, interval, limit: '240', ...(endTime ? { endTime: String(endTime) } : {}) };
  if (endTime) return { symbol, interval, klines: await get('/fapi/v1/klines', klineParams), depth: { bids: [], asks: [] }, premium: { markPrice: '0', indexPrice: '0' }, partial: true };
  const [klines, depth, premium] = await Promise.all([
    get('/fapi/v1/klines', klineParams),
    get('/fapi/v1/depth', { symbol, limit: '1000' }),
    get('/fapi/v1/premiumIndex', { symbol }),
  ]);
  return { symbol, interval, klines, depth, premium: Array.isArray(premium) ? premium[0] : premium };
}

async function serverCoinMMarket(symbol, interval, endTime) {
  if (endTime || !marketDataBase || !marketDataKey) return coinMMarket(symbol, interval, endTime);
  try {
    const response = await fetch(`${marketDataBase}/v1/market/coinm/snapshot?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`, { headers: { Authorization: `Bearer ${marketDataKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`market relay returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn('market relay snapshot unavailable; using direct Binance fallback', error instanceof Error ? error.message : error);
    return coinMMarket(symbol, interval);
  }
}

async function orderBookContext(range) {
  if (!range || !marketDataBase || !marketDataKey) return null;
  try {
    const query = new URLSearchParams({ symbol: 'BTCUSD_PERP', interval: '1m', featureStartTime: String(range.startTime), featureEndTime: String(range.endTime) });
    const response = await fetch(`${marketDataBase}/v1/market/coinm/snapshot?${query}`, { headers: { Authorization: `Bearer ${marketDataKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    return (await response.json()).orderBookWindow || null;
  } catch { return null; }
}

async function pipeServerCoinMStream(request, response, interval) {
  if (!marketDataBase || !marketDataKey) return false;
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  response.once('close', disconnect);
  try {
    const upstream = await fetch(`${marketDataBase}/v1/market/coinm/stream?symbol=BTCUSD_PERP&interval=${encodeURIComponent(interval)}`, { headers: { Authorization: `Bearer ${marketDataKey}` }, signal: controller.signal });
    if (!upstream.ok || !upstream.body) return false;
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for await (const chunk of upstream.body) response.write(chunk);
    response.end();
    return true;
  } catch {
    if (!response.headersSent) return false;
    response.end();
    return true;
  } finally { response.off('close', disconnect); }
}

async function createDraft(rawIntent) {
  const intent = normalizeOrderIntent(rawIntent, { allowedSymbols });
  const [exchange, ticker, account] = await Promise.all([binance.exchangeInfo(intent.symbol), binance.ticker(intent.symbol), accountSnapshot()]);
  const symbolInfo = exchange.symbols?.[0];
  const estimate = validateOrder(intent, { symbolInfo, ticker, balances: account.balances, maxOrderUsdt });
  await binance.testOrder(intent);
  cleanDrafts();
  const draft = { id: randomUUID(), confirmationToken: randomUUID(), intent, estimate, environment, createdAt: Date.now(), state: 'pending' };
  drafts.set(draft.id, draft);
  return draft;
}

function createFuturesDraft(raw) {
  const symbol = String(raw?.symbol || '').toUpperCase();
  const side = String(raw?.side || '').toUpperCase();
  const type = String(raw?.type || 'MARKET').toUpperCase();
  const marginType = String(raw?.marginType || 'ISOLATED').toUpperCase();
  const leverage = Number(raw?.leverage || 1);
  const quantity = String(raw?.quantity || '');
  if (!symbol || !symbolAllowed(symbol)) throw new Error('Futures symbol is not in the trading allowlist.');
  if (!['BUY', 'SELL'].includes(side) || type !== 'MARKET') throw new Error('Futures currently supports MARKET BUY or SELL only.');
  if (!['ISOLATED', 'CROSSED'].includes(marginType)) throw new Error('marginType must be ISOLATED or CROSSED.');
  if (!/^\d+(?:\.\d+)?$/.test(quantity) || Number(quantity) <= 0) throw new Error('Futures quantity must be a positive decimal.');
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 125) throw new Error('Futures leverage must be an integer from 1x to 125x.');
  const draft = { id: randomUUID(), confirmationToken: randomUUID(), intent: { symbol, side, type, quantity, leverage, marginType, reduceOnly: Boolean(raw.reduceOnly) }, environment, createdAt: Date.now(), state: 'pending' };
  futuresDrafts.set(draft.id, draft);
  return draft;
}

function createMarginDraft(raw) {
  const symbol = String(raw?.symbol || '').toUpperCase(); const side = String(raw?.side || '').toUpperCase(); const type = String(raw?.type || 'MARKET').toUpperCase();
  const isIsolated = String(raw?.marginType || 'ISOLATED').toUpperCase() === 'ISOLATED'; const quantity = String(raw?.quantity || ''); const quoteOrderQty = String(raw?.quoteOrderQty || '');
  if (!symbol || !symbolAllowed(symbol)) throw new Error('Margin symbol is not in the trading allowlist.');
  if (!['BUY', 'SELL'].includes(side) || type !== 'MARKET') throw new Error('Margin currently supports MARKET BUY or SELL only.');
  if (!(quantity || quoteOrderQty) || (quantity && !/^\d+(?:\.\d+)?$/.test(quantity)) || (quoteOrderQty && !/^\d+(?:\.\d+)?$/.test(quoteOrderQty))) throw new Error('Margin quantity must be a positive decimal.');
  const intent = { symbol, side, type, isIsolated: String(isIsolated), ...(quantity ? { quantity } : { quoteOrderQty }) };
  const draft = { id: randomUUID(), confirmationToken: randomUUID(), intent, environment, createdAt: Date.now(), state: 'pending' };
  marginDrafts.set(draft.id, draft); return draft;
}

export function createCryptoServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/api/status') {
        return sendJson(response, 200, { configured, environment, liveTradingEnabled, allowedSymbols, maxOrderUsdt, futures: { configured, maxLeverage: 125, confirmationRequired: true }, margin: { configured, confirmationRequired: true, borrowRepayEnabled: false }, news: { configured: news.feedUrls.length > 0 || news.apiSources.length > 0, sources: [...news.feedUrls.map((url) => new URL(url).hostname), ...news.apiSources.map((source) => source.name)], learningEnabled: Boolean(newsLearner), pollMs: news.pollMs }, model: { provider: gatewayProvider, models: modelOptions, reasoning: reasoningOptions, defaultModel, defaultReasoning } });
      }
      if (request.method === 'GET' && (request.url?.startsWith('/api/news?') || request.url === '/api/news')) {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const mode = query.get('mode');
        if (mode === 'startup' && (news.feedUrls.length || news.apiSources.length)) await news.poll();
        return sendJson(response, 200, await news.history({ limit: Math.min(100, Math.max(1, Number(query.get('limit') || 30))), before: query.get('before') || '' }));
      }
      if (request.method === 'GET' && request.url === '/api/news/stream') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        response.write(`event: ready\ndata: ${JSON.stringify({ items: news.recent(10) })}\n\n`); newsClients.add(response);
        request.on('close', () => newsClients.delete(response)); return;
      }
      if (request.method === 'GET' && request.url === '/api/news/knowledge') {
        return sendJson(response, 200, { items: newsLearner?.store ? newsLearner.store.listSources().slice(0, 30) : [] });
      }
      if (request.method === 'GET' && request.url === '/api/emergency/status') return sendJson(response, 200, emergency.status());
      if (request.method === 'POST' && request.url === '/api/emergency/confirm') {
        const payload = await body(request);
        return sendJson(response, 200, { grant: emergency.confirm(payload) });
      }
      if (request.method === 'POST' && request.url === '/api/emergency/revoke') {
        const payload = await body(request);
        return sendJson(response, 200, { revoked: emergency.revoke(String(payload.reason || 'manual')) });
      }
      if (request.method === 'POST' && request.url === '/api/emergency/order') {
        if (!liveTradingEnabled) return sendJson(response, 403, { error: 'Live trading is locked; emergency orders remain disabled.' });
        const payload = await body(request);
        const draft = await createDraft(payload.intent);
        emergency.consume({ grantId: String(payload.grantId || ''), notional: draft.estimate.estimatedNotional });
        const order = await binance.placeOrder({ ...draft.intent, newClientOrderId: `ea_emergency_${draft.id.replaceAll('-', '').slice(0, 20)}` });
        return sendJson(response, 200, { order, authorization: emergency.status().grant });
      }
      if (request.method === 'GET' && request.url === '/api/account') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials in apps/crypto-agent/.env.' });
        return sendJson(response, 200, await accountSnapshot());
      }
      if (request.method === 'GET' && request.url === '/api/assets') return sendJson(response, 200, await assetSnapshot());
      if (request.method === 'GET' && request.url === '/api/futures/account') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before reading Futures.' });
        return sendJson(response, 200, await futures.account());
      }
      if (request.method === 'GET' && request.url === '/api/margin/account') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before reading Margin.' });
        return sendJson(response, 200, await margin.account());
      }
      if (request.method === 'POST' && request.url === '/api/margin/drafts') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before preparing a Margin order.' });
        return sendJson(response, 200, { draft: createMarginDraft(await body(request)) });
      }
      if (request.method === 'POST' && request.url === '/api/margin/actions/drafts') {
        const payload = await body(request); const action = String(payload.action || '').toUpperCase(); const asset = String(payload.asset || '').toUpperCase(); const amount = String(payload.amount || '');
        if (!['BORROW', 'REPAY'].includes(action) || !asset || !/^\d+(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) return sendJson(response, 400, { error: 'Margin action requires BORROW/REPAY, asset, and a positive amount.' });
        const draft = { id: randomUUID(), confirmationToken: randomUUID(), action, params: { asset, amount, isIsolated: String(Boolean(payload.isIsolated)), symbol: payload.symbol ? String(payload.symbol).toUpperCase() : undefined }, createdAt: Date.now(), state: 'pending' };
        marginActionDrafts.set(draft.id, draft); return sendJson(response, 200, { draft });
      }
      const marginActionConfirm = request.url?.match(/^\/api\/margin\/actions\/drafts\/([^/]+)\/confirm$/);
      if (request.method === 'POST' && marginActionConfirm) {
        const payload = await body(request); const draft = marginActionDrafts.get(marginActionConfirm[1]);
        if (!draft || Date.now() - draft.createdAt > 5 * 60_000) return sendJson(response, 404, { error: 'Margin action draft expired or was not found.' });
        if (draft.state !== 'pending') return sendJson(response, 409, { error: 'This Margin action draft was already handled.' });
        if (payload.confirmation !== 'CONFIRM' || payload.confirmationToken !== draft.confirmationToken) return sendJson(response, 400, { error: 'Explicit confirmation for this exact Margin action is required.' });
        if (!liveTradingEnabled) return sendJson(response, 403, { error: 'Live trading is locked; Margin actions are disabled.' });
        draft.state = 'submitting'; const result = draft.action === 'BORROW' ? await margin.borrow(draft.params) : await margin.repay(draft.params); draft.state = 'submitted'; return sendJson(response, 200, { result });
      }
      const marginConfirm = request.url?.match(/^\/api\/margin\/drafts\/([^/]+)\/confirm$/);
      if (request.method === 'POST' && marginConfirm) {
        const payload = await body(request); const draft = marginDrafts.get(marginConfirm[1]);
        if (!draft || Date.now() - draft.createdAt > 5 * 60_000) return sendJson(response, 404, { error: 'Margin draft expired or was not found.' });
        if (draft.state !== 'pending') return sendJson(response, 409, { error: 'This Margin draft was already handled.' });
        if (payload.confirmation !== 'CONFIRM' || payload.confirmationToken !== draft.confirmationToken) return sendJson(response, 400, { error: 'Explicit confirmation for this exact Margin draft is required.' });
        if (!liveTradingEnabled) return sendJson(response, 403, { error: 'Live trading is locked; Margin submission is disabled.' });
        draft.state = 'submitting';
        try { const order = await margin.order(draft.intent); draft.state = 'submitted'; return sendJson(response, 200, { order }); }
        catch (error) { draft.state = error instanceof BinanceApiError && error.executionUnknown ? 'unknown' : 'failed'; throw error; }
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/futures/positions')) {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before reading Futures.' });
        const symbol = new URL(request.url, 'http://localhost').searchParams.get('symbol')?.toUpperCase();
        return sendJson(response, 200, await futures.positionRisk(symbol));
      }
      if (request.method === 'POST' && request.url === '/api/futures/drafts') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before preparing a Futures order.' });
        return sendJson(response, 200, { draft: createFuturesDraft(await body(request)) });
      }
      const futuresConfirm = request.url?.match(/^\/api\/futures\/drafts\/([^/]+)\/confirm$/);
      if (request.method === 'POST' && futuresConfirm) {
        const payload = await body(request);
        const draft = futuresDrafts.get(futuresConfirm[1]);
        if (!draft || Date.now() - draft.createdAt > 5 * 60_000) return sendJson(response, 404, { error: 'Futures draft expired or was not found.' });
        if (draft.state !== 'pending') return sendJson(response, 409, { error: 'This Futures draft was already handled.' });
        if (payload.confirmation !== 'CONFIRM' || payload.confirmationToken !== draft.confirmationToken) return sendJson(response, 400, { error: 'Explicit confirmation for this exact Futures draft is required.' });
        if (!liveTradingEnabled) return sendJson(response, 403, { error: 'Live trading is locked; Futures submission is disabled.' });
        draft.state = 'submitting';
        try {
          await futures.marginType(draft.intent.symbol, draft.intent.marginType);
          await futures.leverage(draft.intent.symbol, draft.intent.leverage);
          const order = await futures.placeOrder({ symbol: draft.intent.symbol, side: draft.intent.side, type: draft.intent.type, quantity: draft.intent.quantity, reduceOnly: draft.intent.reduceOnly ? 'true' : undefined, newClientOrderId: `ea_futures_${draft.id.replaceAll('-', '').slice(0, 20)}` });
          draft.state = 'submitted';
          return sendJson(response, 200, { order });
        } catch (error) { draft.state = error instanceof BinanceApiError && error.executionUnknown ? 'unknown' : 'failed'; throw error; }
      }
      if (request.method === 'GET' && request.url === '/api/permissions') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials in apps/crypto-agent/.env.' });
        const account = await binance.account();
        return sendJson(response, 200, { permissions: auditBinancePermissions(account) });
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/ticker?')) {
        const symbol = new URL(request.url, 'http://localhost').searchParams.get('symbol')?.toUpperCase();
        if (!symbol || !symbolAllowed(symbol)) return sendJson(response, 400, { error: 'Symbol is not allowed.' });
        return sendJson(response, 200, await binance.ticker(symbol));
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/klines?')) {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const symbol = query.get('symbol')?.toUpperCase();
        const interval = query.get('interval') || '1m';
        if (!symbol || !symbolAllowed(symbol)) return sendJson(response, 400, { error: 'Symbol is not allowed.' });
        if (!['1m', '5m', '15m', '1h', '4h', '1d'].includes(interval)) return sendJson(response, 400, { error: 'Interval is not allowed.' });
        return sendJson(response, 200, { symbol, interval, klines: await binance.klines(symbol, interval, 120) });
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/coinm-market?')) {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const symbol = query.get('symbol')?.toUpperCase() || 'BTCUSD_PERP';
        const interval = query.get('interval') || '5m';
        const endTime = query.get('endTime');
        if (symbol !== 'BTCUSD_PERP') return sendJson(response, 400, { error: 'Only BTCUSD_PERP is available in this first Coin-M view.' });
        if (!['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'].includes(interval)) return sendJson(response, 400, { error: 'Interval is not allowed.' });
        if (endTime && (!/^\d+$/.test(endTime) || Number(endTime) <= 0)) return sendJson(response, 400, { error: 'endTime is not valid.' });
        return sendJson(response, 200, await serverCoinMMarket(symbol, interval, endTime ? Number(endTime) : undefined));
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/usdm-market?')) {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const symbol = query.get('symbol')?.toUpperCase() || 'BTCUSDT';
        const interval = query.get('interval') || '5m';
        const endTime = query.get('endTime');
        if (symbol !== 'BTCUSDT') return sendJson(response, 400, { error: 'Only BTCUSDT is available in this first USD-M view.' });
        if (!['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'].includes(interval)) return sendJson(response, 400, { error: 'Interval is not allowed.' });
        if (endTime && (!/^\d+$/.test(endTime) || Number(endTime) <= 0)) return sendJson(response, 400, { error: 'endTime is not valid.' });
        return sendJson(response, 200, await usdMMarket(symbol, interval, endTime ? Number(endTime) : undefined));
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/usdm-history?')) {
        if (!configured) return sendJson(response, 200, { rows: [] });
        const symbol = new URL(request.url, 'http://localhost').searchParams.get('symbol')?.toUpperCase() || 'BTCUSDT';
        if (symbol !== 'BTCUSDT') return sendJson(response, 400, { error: 'Only BTCUSDT is available in this first USD-M view.' });
        try { return sendJson(response, 200, { rows: await futures.userTrades(symbol, 50) }); } catch { return sendJson(response, 200, { rows: [] }); }
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/coinm-stream?')) {
        const interval = new URL(request.url, 'http://localhost').searchParams.get('interval') || '5m';
        if (!['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'].includes(interval)) return sendJson(response, 400, { error: 'Interval is not allowed.' });
        if (await pipeServerCoinMStream(request, response, interval)) return;
        return sendJson(response, 503, { error: 'Server market relay unavailable.' });
      }
      if (request.method === 'POST' && request.url === '/api/chat') {
        const payload = await body(request, 6_000_000);
        const message = String(payload.message || '').trim();
        const image = payload.image;
        if (!message && !image) return sendJson(response, 400, { error: 'A message or image is required.' });
        if (image && !validImageDataUrl(image)) return sendJson(response, 400, { error: 'Only PNG, JPEG, and WebP image data is accepted.' });
        let parsed;
        const model = modelOptions.includes(payload.model) ? payload.model : defaultModel;
        const reasoningEffort = reasoningOptions.includes(payload.reasoning_effort) ? payload.reasoning_effort : defaultReasoning;
        if (!isTradeCommand(message)) {
          if (!gateway) return sendJson(response, 503, { error: 'Configure a model gateway before asking for market analysis.' });
          const range = requestedOrderBookRange(message);
          const bookWindow = await orderBookContext(range);
          const marketContext = bookWindow ? { ...(payload.marketContext || {}), orderBookWindow: { ...bookWindow, requestedRange: range } } : payload.marketContext;
          const reply = await gateway.complete(analysisMessages({ message: message || '请分析这张图片。', history: payload.history, marketContext, image }), { model, reasoningEffort });
          return sendJson(response, 200, { reply });
        }
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before preparing an order.' });
        const product = inferProduct(message);
        if (gateway) parsed = parseModelJson(await gateway.complete([{ role: 'system', content: product === 'spot' ? tradePrompt(message, allowedSymbols || ['any USDT spot symbol']) : multiProductTradePrompt(message, allowedSymbols || ['any USDT symbol']) }], { model, reasoningEffort }));
        else parsed = { reply: '', intent: fallbackIntent(message) };
        if (!parsed?.intent) return sendJson(response, 200, { reply: parsed?.reply || '请明确交易方向、交易对和数量，例如“用 50 USDT 市价买入 BTC”。' });
        const resolvedProduct = parsed.product || product;
        const draft = resolvedProduct === 'futures' ? createFuturesDraft(parsed.intent) : resolvedProduct === 'margin' ? createMarginDraft(parsed.intent) : await createDraft(parsed.intent);
        return sendJson(response, 200, { reply: parsed.reply || '订单草案已准备好。请核对产品、方向、数量、杠杆和保证金模式后确认。', product: resolvedProduct, draft });
      }
      const confirm = request.url?.match(/^\/api\/orders\/([^/]+)\/confirm$/);
      if (request.method === 'POST' && confirm) {
        const payload = await body(request);
        const draft = drafts.get(confirm[1]);
        if (!draft || Date.now() - draft.createdAt > 5 * 60_000) return sendJson(response, 404, { error: 'Order draft expired or was not found.' });
        if (draft.state !== 'pending') return sendJson(response, 409, { error: 'This order draft was already handled.' });
        if (payload.confirmation !== 'CONFIRM' || payload.confirmationToken !== draft.confirmationToken) return sendJson(response, 400, { error: 'Explicit confirmation for this exact order draft is required.' });
        if (environment === 'live' && !liveTradingEnabled) return sendJson(response, 403, { error: 'Live trading is locked. Set BINANCE_LIVE_TRADING=true only after completing the safety checklist.' });
        draft.state = 'submitting';
        try {
          const order = await binance.placeOrder({ ...draft.intent, newClientOrderId: `ea_${draft.id.replaceAll('-', '').slice(0, 28)}` });
          draft.state = 'submitted';
          return sendJson(response, 200, { order });
        } catch (error) {
          draft.state = error instanceof BinanceApiError && error.executionUnknown ? 'unknown' : 'failed';
          throw error;
        }
      }
      return sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      const result = publicError(error);
      return sendJson(response, result.status, { error: result.message });
    }
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) createCryptoServer().listen(port, '127.0.0.1', () => console.log(`CryptoAgent API listening on http://127.0.0.1:${port} (${environment})`));
