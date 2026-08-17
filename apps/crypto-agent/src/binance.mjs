import { createHmac } from 'node:crypto';

const BASE_URLS = {
  testnet: 'https://testnet.binance.vision',
  live: 'https://api.binance.com',
};

function compactParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

export function signQuery(params, secretKey) {
  const query = new URLSearchParams(compactParams(params)).toString();
  const signature = createHmac('sha256', secretKey).update(query).digest('hex');
  return `${query}&signature=${signature}`;
}

export class BinanceApiError extends Error {
  constructor(message, { status, code, executionUnknown = false } = {}) {
    super(message);
    this.name = 'BinanceApiError';
    this.status = status;
    this.code = code;
    this.executionUnknown = executionUnknown;
  }
}

export function createBinanceSpotClient({ apiKey, secretKey, environment = 'testnet', fetchImpl = fetch, now = Date.now, recvWindow = 5_000 } = {}) {
  const baseUrl = BASE_URLS[environment];
  if (!baseUrl) throw new Error('Binance environment must be testnet or live.');
  let clockOffset = 0;
  let clockSynced = false;

  async function request(method, path, params = {}, signed = false) {
    if (signed && (!apiKey || !secretKey)) throw new BinanceApiError('Binance API credentials are not configured.', { status: 503 });
    if (signed && !clockSynced) {
      const { serverTime } = await request('GET', '/api/v3/time');
      clockOffset = Number(serverTime) - now();
      clockSynced = true;
    }
    const values = signed ? { ...params, recvWindow, timestamp: now() + clockOffset } : params;
    const query = signed ? signQuery(values, secretKey) : new URLSearchParams(compactParams(values)).toString();
    const response = await fetchImpl(`${baseUrl}${path}${query ? `?${query}` : ''}`, {
      method,
      headers: signed ? { 'X-MBX-APIKEY': apiKey } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const executionUnknown = response.status >= 500 && method !== 'GET';
      throw new BinanceApiError(body.msg || `Binance request failed (${response.status}).`, { status: response.status, code: body.code, executionUnknown });
    }
    return body;
  }

  return {
    environment,
    ping: () => request('GET', '/api/v3/ping'),
    ticker: (symbol) => request('GET', '/api/v3/ticker/bookTicker', { symbol }),
    exchangeInfo: (symbol) => request('GET', '/api/v3/exchangeInfo', { symbol }),
    account: () => request('GET', '/api/v3/account', { omitZeroBalances: true }, true),
    testOrder: (order) => request('POST', '/api/v3/order/test', order, true),
    placeOrder: (order) => request('POST', '/api/v3/order', order, true),
  };
}
