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
    assert.equal((await post(port, path, { confirmation: 'CONFIRM' })).status, 200);
    assert.equal((await post(port, path, { confirmation: 'CONFIRM' })).status, 409);
    assert.equal(placed, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    if (originalEnv.key === undefined) delete process.env.BINANCE_API_KEY; else process.env.BINANCE_API_KEY = originalEnv.key;
    if (originalEnv.secret === undefined) delete process.env.BINANCE_SECRET_KEY; else process.env.BINANCE_SECRET_KEY = originalEnv.secret;
    if (originalEnv.mode === undefined) delete process.env.BINANCE_ENV; else process.env.BINANCE_ENV = originalEnv.mode;
  }
});
