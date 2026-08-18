import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

function post(port, path, payload) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(raw) }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(payload));
  });
}

test('an expiring server-side draft can only submit once', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { key: process.env.BINANCE_API_KEY, secret: process.env.BINANCE_SECRET_KEY, mode: process.env.BINANCE_ENV };
  process.env.BINANCE_API_KEY = 'test-key';
  process.env.BINANCE_SECRET_KEY = 'test-secret';
  process.env.BINANCE_ENV = 'testnet';
  let placed = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const response = path === '/api/v3/time' ? { serverTime: Date.now() }
      : path === '/api/v3/account' ? { canTrade: true, balances: [{ asset: 'USDT', free: '1000', locked: '0' }] }
        : path === '/api/v3/exchangeInfo' ? { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', isSpotTradingAllowed: true, baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'MARKET_LOT_SIZE', minQty: '0', maxQty: '10', stepSize: '0' }, { filterType: 'MIN_NOTIONAL', minNotional: '5' }] }] }
          : path === '/api/v3/ticker/bookTicker' ? { bidPrice: '49900', askPrice: '50000' }
            : path === '/api/v3/order/test' ? {}
              : path === '/api/v3/order' ? (placed += 1, { orderId: 42 }) : {};
    return new Response(JSON.stringify(response), { status: 200 });
  };
  const { createCryptoServer } = await import(`./index.mjs?test=${Date.now()}`);
  const server = createCryptoServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const chat = await post(port, '/api/chat', { message: '用 50 USDT 市价买入 BTC' });
    assert.equal(chat.status, 200);
    const path = `/api/orders/${chat.body.draft.id}/confirm`;
    assert.equal((await post(port, path, { confirmation: 'CONFIRM' })).status, 400);
    assert.equal((await post(port, path, { confirmation: 'CONFIRM', confirmationToken: chat.body.draft.confirmationToken })).status, 200);
    assert.equal((await post(port, path, { confirmation: 'CONFIRM', confirmationToken: chat.body.draft.confirmationToken })).status, 409);
    assert.equal(placed, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    if (originalEnv.key === undefined) delete process.env.BINANCE_API_KEY; else process.env.BINANCE_API_KEY = originalEnv.key;
    if (originalEnv.secret === undefined) delete process.env.BINANCE_SECRET_KEY; else process.env.BINANCE_SECRET_KEY = originalEnv.secret;
    if (originalEnv.mode === undefined) delete process.env.BINANCE_ENV; else process.env.BINANCE_ENV = originalEnv.mode;
  }
});

test('market analysis sends chart context, history, and pasted images to the model gateway', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { base: process.env.GATEWAY_BASE_URL, key: process.env.GATEWAY_API_KEY, remoteNews: process.env.NEWS_REMOTE_ONLY };
  process.env.GATEWAY_BASE_URL = 'https://gateway.example';
  process.env.GATEWAY_API_KEY = 'gateway-key';
  process.env.NEWS_REMOTE_ONLY = 'true';
  let gatewayRequest;
  let marketRequest;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/v1/market/coinm/snapshot')) {
      marketRequest = String(url);
      return new Response(JSON.stringify({ orderBookWindow: { startTime: 1, endTime: 2, resolutionMs: 1_000, sourceSamples: 1, points: [{ time: 1, samples: 1, mid: 100 }] } }), { status: 200 });
    }
    if (String(url).endsWith('/v1/chat/completions')) {
      gatewayRequest = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '只读分析结果' } }] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  const { createCryptoServer } = await import(`./index.mjs?analysis=${Date.now()}`);
  const server = createCryptoServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const result = await post(port, '/api/chat', { message: '分析最近5分钟的盘口和这张图', history: [{ role: 'assistant', content: '前文' }], image: 'data:image/png;base64,aGVsbG8=', marketContext: { symbol: 'BTCUSD_PERP', interval: '5m', candles: [{ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 2 }] } });
    assert.equal(result.status, 200);
    assert.equal(result.body.reply, '只读分析结果');
    assert.match(gatewayRequest.messages[0].content, /BTCUSD_PERP/);
    assert.match(gatewayRequest.messages[0].content, /orderBookWindow/);
    assert.match(marketRequest, /featureStartTime=\d+&featureEndTime=\d+/);
    assert.equal(gatewayRequest.messages[1].content, '前文');
    assert.equal(gatewayRequest.messages.at(-1).content[1].image_url.url, 'data:image/png;base64,aGVsbG8=');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    if (originalEnv.base === undefined) delete process.env.GATEWAY_BASE_URL; else process.env.GATEWAY_BASE_URL = originalEnv.base;
    if (originalEnv.key === undefined) delete process.env.GATEWAY_API_KEY; else process.env.GATEWAY_API_KEY = originalEnv.key;
    if (originalEnv.remoteNews === undefined) delete process.env.NEWS_REMOTE_ONLY; else process.env.NEWS_REMOTE_ONLY = originalEnv.remoteNews;
  }
});
