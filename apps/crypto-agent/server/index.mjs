import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createModelGateway } from '@evolving-agents/model-gateway';
import { parseModelJson } from '@evolving-agents/learning-engine';
import { BinanceApiError, createBinanceSpotClient } from '../src/binance.mjs';
import { auditBinancePermissions } from '../src/permissions.mjs';
import { fallbackIntent, normalizeOrderIntent, tradePrompt, validateOrder } from '../src/trading.mjs';

const port = Number(process.env.CRYPTO_AGENT_API_PORT || 5451);
const environment = process.env.BINANCE_ENV === 'live' ? 'live' : 'testnet';
const liveTradingEnabled = environment === 'live' && process.env.BINANCE_LIVE_TRADING === 'true';
const allowedSymbols = (process.env.BINANCE_SYMBOLS || 'BTCUSDT,ETHUSDT').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
const maxOrderUsdt = Number(process.env.MAX_ORDER_USDT || 100);
const configured = Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY);
const binance = createBinanceSpotClient({ apiKey: process.env.BINANCE_API_KEY, secretKey: process.env.BINANCE_SECRET_KEY, environment });
const gateway = process.env.GATEWAY_BASE_URL && process.env.GATEWAY_API_KEY
  ? createModelGateway({ baseUrl: process.env.GATEWAY_BASE_URL, apiKey: process.env.GATEWAY_API_KEY })
  : null;
const drafts = new Map();

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
  const draft = { id: randomUUID(), intent, estimate, environment, createdAt: Date.now(), state: 'pending' };
  drafts.set(draft.id, draft);
  return draft;
}

export function createCryptoServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/api/status') {
        return sendJson(response, 200, { configured, environment, liveTradingEnabled, allowedSymbols, maxOrderUsdt });
      }
      if (request.method === 'GET' && request.url === '/api/account') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials in apps/crypto-agent/.env.' });
        return sendJson(response, 200, await accountSnapshot());
      }
      if (request.method === 'GET' && request.url === '/api/permissions') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials in apps/crypto-agent/.env.' });
        const account = await binance.account();
        return sendJson(response, 200, { permissions: auditBinancePermissions(account) });
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/ticker?')) {
        const symbol = new URL(request.url, 'http://localhost').searchParams.get('symbol')?.toUpperCase();
        if (!symbol || !allowedSymbols.includes(symbol)) return sendJson(response, 400, { error: 'Symbol is not allowed.' });
        return sendJson(response, 200, await binance.ticker(symbol));
      }
      if (request.method === 'POST' && request.url === '/api/chat') {
        if (!configured) return sendJson(response, 503, { error: 'Configure Binance credentials before preparing an order.' });
        const payload = await body(request);
        const message = String(payload.message || '').trim();
        if (!message) return sendJson(response, 400, { error: 'A message is required.' });
        let parsed;
        if (gateway) parsed = parseModelJson(await gateway.complete([{ role: 'system', content: tradePrompt(message, allowedSymbols) }], { quality: payload.quality === 'High' ? 'High' : 'Medium' }));
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
        if (payload.confirmation !== 'CONFIRM') return sendJson(response, 400, { error: 'Explicit confirmation is required.' });
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
