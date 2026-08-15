import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelGateway, responseText } from '../src/index.mjs';

test('extracts an OpenAI-compatible assistant response', () => {
  assert.equal(responseText({ choices: [{ message: { content: 'Policy answer' } }] }), 'Policy answer');
  assert.throws(() => responseText({ choices: [] }), /no assistant message/);
});

test('sends the configured provider, quality, and bearer token', async () => {
  let request;
  const gateway = createModelGateway({ baseUrl: 'https://gateway.example/', apiKey: 'secret', fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'answer' } }] }) };
  } });
  assert.equal(await gateway.complete([{ role: 'user', content: 'hello' }], { quality: 'High' }), 'answer');
  assert.equal(request.url, 'https://gateway.example/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(request.options.body), { provider: 'deepseek', quality: 'High', messages: [{ role: 'user', content: 'hello' }] });
});

test('preserves gateway status and error messages', async () => {
  const gateway = createModelGateway({ baseUrl: 'https://gateway.example', apiKey: 'secret', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) }) });
  await assert.rejects(() => gateway.complete([{ role: 'user', content: 'hello' }]), (error) => error.status === 429 && error.message === 'rate limited');
});
