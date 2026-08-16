import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelGateway, createOpenAICompatibleGateway, responseDelta, responseText } from '../src/index.mjs';

test('extracts an OpenAI-compatible assistant response', () => {
  assert.equal(responseText({ choices: [{ message: { content: 'Policy answer' } }] }), 'Policy answer');
  assert.throws(() => responseText({ choices: [] }), /no assistant message/);
});

test('extracts OpenAI-compatible stream deltas', () => {
  assert.equal(responseDelta({ choices: [{ delta: { content: 'next' } }] }), 'next');
  assert.equal(responseDelta({ choices: [{ delta: {} }] }), '');
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

test('sends OpenAI-compatible local model requests with a model name', async () => {
  let request;
  const gateway = createOpenAICompatibleGateway({ baseUrl: 'http://127.0.0.1:11434/v1/', model: 'qwen3:8b', fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'local answer' } }] }) };
  } });
  assert.equal(await gateway.complete([{ role: 'user', content: 'hello' }]), 'local answer');
  assert.equal(request.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer local');
  assert.deepEqual(JSON.parse(request.options.body), { model: 'qwen3:8b', messages: [{ role: 'user', content: 'hello' }], stream: false });
});

test('preserves gateway status and error messages', async () => {
  const gateway = createModelGateway({ baseUrl: 'https://gateway.example', apiKey: 'secret', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) }) });
  await assert.rejects(() => gateway.complete([{ role: 'user', content: 'hello' }]), (error) => error.status === 429 && error.message === 'rate limited');
});

test('uploads files through the gateway file endpoint', async () => {
  let request;
  const gateway = createModelGateway({ baseUrl: 'https://gateway.example/', apiKey: 'secret', fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: 'file_123' }) };
  } });
  assert.equal(await gateway.uploadFile({ name: 'guide.pdf', type: 'application/pdf', data: new Uint8Array([1, 2, 3]) }), 'file_123');
  assert.equal(request.url, 'https://gateway.example/v1/files');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.equal(request.options.body.get('purpose'), 'user_data');
  assert.equal(request.options.body.get('file').name, 'guide.pdf');
});

test('streams split SSE events and returns the complete answer', async () => {
  const encoder = new TextEncoder();
  const chunks = ['data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\r\n\r\ndata: [DONE]\n\n'];
  const gateway = createModelGateway({ baseUrl: 'https://gateway.example', apiKey: 'secret', fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const deltas = [];
  assert.equal(await gateway.stream([{ role: 'user', content: 'hello' }], { onDelta: (delta) => deltas.push(delta) }), 'Hello world');
  assert.deepEqual(deltas, ['Hello', ' world']);
});
