import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisMessages, buildMarketContext, isTradeCommand, validImageDataUrl } from './market-context.mjs';

test('builds bounded read-only chart context and separates analysis from orders', () => {
  const candles = Array.from({ length: 130 }, (_, time) => ({ time, open: 10, high: 12, low: 9, close: 11, volume: 2 }));
  const context = buildMarketContext({ symbol: 'BTCUSD_PERP', interval: '1m', candles });
  assert.equal(context.candles.length, 120);
  assert.equal(context.visibleStart, 10);
  assert.equal(context.indicators.totalVolume, 240);
  assert.equal(isTradeCommand('分析一下现在适合买入吗'), false);
  assert.equal(isTradeCommand('用 100 USDT 买入 BTC'), true);
});

test('builds a multimodal user message from a validated pasted image', () => {
  const image = 'data:image/png;base64,aGVsbG8=';
  assert.equal(validImageDataUrl(image), true);
  const messages = analysisMessages({ message: '分析图片', history: [{ role: 'assistant', content: '前文' }], marketContext: null, image });
  assert.equal(messages.at(-1).content[1].image_url.url, image);
  assert.equal(messages[1].content, '前文');
});
