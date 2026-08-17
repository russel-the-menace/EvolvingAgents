import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createModelGateway } from '@evolving-agents/model-gateway';
import { parseModelJson } from '@evolving-agents/learning-engine';
import { BinanceApiError, createBinanceSpotClient, createBinanceUsdMClient } from '../src/binance.mjs';
import { auditBinancePermissions } from '../src/permissions.mjs';
import { fallbackIntent, hasUnsupportedRiskInstruction, normalizeOrderIntent, tradePrompt, validateOrder } from '../src/trading.mjs';
import { NewsService } from '../src/news.mjs';
import { createNewsLearner } from '../src/news-learning.mjs';
import { EmergencyPolicy } from '../src/emergency-policy.mjs';

const port = Number(process.env.CRYPTO_AGENT_API_PORT || 5451);
const environment = process.env.BINANCE_ENV === 'live' ? 'live' : 'testnet';
const liveTradingEnabled = environment === 'live' && process.env.BINANCE_LIVE_TRADING === 'true';
const symbolConfig = (process.env.BINANCE_SYMBOLS || 'BTCUSDT,ETHUSDT').trim();
const allowedSymbols = symbolConfig === '*' ? null : symbolConfig.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
const maxOrderUsdt = Number(process.env.MAX_ORDER_USDT || 100);
const configured = Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY);
const gatewayProvider = process.env.GATEWAY_PROVIDER || 'openai';
const modelOptions = ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'];
const reasoningOptions = ['low', 'medium', 'high', 'xhigh', 'max'];
const defaultModel = modelOptions.includes(process.env.GATEWAY_MODEL) ? process.env.GATEWAY_MODEL : 'gpt-5.6-luna';
const defaultReasoning = reasoningOptions.includes(process.env.GATEWAY_REASONING_EFFORT) ? process.env.GATEWAY_REASONING_EFFORT : 'medium';
const binance = createBinanceSpotClient({ apiKey: process.env.BINANCE_API_KEY, secretKey: process.env.BINANCE_SECRET_KEY, environment });
const futures = createBinanceUsdMClient({ apiKey: process.env.BINANCE_API_KEY, secretKey: process.env.BINANCE_SECRET_KEY, environment });
const gateway = process.env.GATEWAY_BASE_URL && process.env.GATEWAY_API_KEY
  ? createModelGateway({ baseUrl: process.env.GATEWAY_BASE_URL, apiKey: process.env.GATEWAY_API_KEY, provider: gatewayProvider, model: defaultModel, reasoningEffort: defaultReasoning })
  : null;
const drafts = new Map();
const futuresDrafts = new Map();
const symbolAllowed = (symbol) => !allowedSymbols || allowedSymbols.includes(symbol);
const defaultNewsState = process.platform === 'darwin' && process.env.HOME ? `${process.env.HOME}/Library/Application Support/CryptoAgent/news-state.json` : '';
const defaultNewsKnowledge = process.platform === 'darwin' && process.env.HOME ? `${process.env.HOME}/Library/Application Support/CryptoAgent/news-knowledge.sqlite` : '';
const newsLearner = createNewsLearner(process.env.NEWS_LEARNING_DB_FILE || defaultNewsKnowledge);
const news = new NewsService({ feedUrls: (process.env.NEWS_RSS_URLS || '').split(',').map((item) => item.trim()).filter(Boolean), stateFile: process.env.NEWS_STATE_FILE || defaultNewsState, pollMs: Number(process.env.NEWS_POLL_MS || 300_000), learnItem: newsLearner?.learn });
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
async function body(request) {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 50_000) throw new Error('Request body is too large.'); }
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

export function createCryptoServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/api/status') {
        return sendJson(response, 200, { configured, environment, liveTradingEnabled, allowedSymbols, maxOrderUsdt, futures: { configured, maxLeverage: 125, confirmationRequired: true }, news: { configured: news.feedUrls.length > 0, learningEnabled: Boolean(newsLearner), pollMs: news.pollMs }, model: { provider: gatewayProvider, models: modelOptions, reasoning: reasoningOptions, defaultModel, defaultReasoning } });
      }
      if (request.method === 'GET' && request.url === '/api/news') {
        const mode = new URL(request.url, 'http://localhost').searchParams.get('mode');
        if (mode === 'startup' && news.feedUrls.length) await news.poll();
        return sendJson(response, 200, { items: mode === 'startup' ? await news.startupDigest() : news.recent() });
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
      if (request.method === 'GET' && request.url === '/api/futures/account') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before reading Futures.' });
        return sendJson(response, 200, await futures.account());
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
      if (request.method === 'POST' && request.url === '/api/chat') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before preparing an order.' });
        const payload = await body(request);
        const message = String(payload.message || '').trim();
        if (!message) return sendJson(response, 400, { error: 'A message is required.' });
        if (hasUnsupportedRiskInstruction(message)) return sendJson(response, 200, { reply: '这条指令包含杠杆、合约或全仓风险。当前聊天执行器只支持现货，不能把它静默转换成现货订单。请先使用受控的风险策略流程。' });
        let parsed;
        const model = modelOptions.includes(payload.model) ? payload.model : defaultModel;
        const reasoningEffort = reasoningOptions.includes(payload.reasoning_effort) ? payload.reasoning_effort : defaultReasoning;
        if (gateway) parsed = parseModelJson(await gateway.complete([{ role: 'system', content: tradePrompt(message, allowedSymbols || ['any USDT spot symbol']) }], { model, reasoningEffort }));
        else parsed = { reply: '', intent: fallbackIntent(message) };
        if (!parsed?.intent) return sendJson(response, 200, { reply: parsed?.reply || '请明确交易方向、交易对和数量，例如“用 50 USDT 市价买入 BTC”。' });
        const draft = await createDraft(parsed.intent);
        return sendJson(response, 200, { reply: parsed.reply || '订单草案已通过余额、限额和币安测试单校验。请核对后确认。', draft });
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
