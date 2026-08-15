import { createServer } from 'node:http';

const port = Number(process.env.CAMPUS_ATLAS_API_PORT || 5445);
const gatewayBaseUrl = process.env.GATEWAY_BASE_URL?.replace(/\/$/, '');
const gatewayApiKey = process.env.GATEWAY_API_KEY;

export function responseText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  throw new Error('Gateway returned no assistant message.');
}

function sendJson(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }

async function requestBody(request) {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 1_000_000) throw new Error('Request body is too large.'); }
  return JSON.parse(raw);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/api/chat') return sendJson(response, 404, { error: 'Not found.' });
  if (!gatewayBaseUrl || !gatewayApiKey) return sendJson(response, 503, { error: 'Gateway is not configured. Set GATEWAY_BASE_URL and GATEWAY_API_KEY in .env.' });
  try {
    const { messages } = await requestBody(request);
    if (!Array.isArray(messages) || !messages.length || !messages.every((message) => ['user', 'assistant', 'system'].includes(message.role) && typeof message.content === 'string')) throw new Error('Messages must be a non-empty OpenAI-style message list.');
    const upstream = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${gatewayApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'deepseek', quality: process.env.DEEPSEEK_QUALITY || 'Medium', messages }), signal: AbortSignal.timeout(120_000) });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return sendJson(response, upstream.status, { error: body.error?.message || body.error || 'Gateway request failed.' });
    return sendJson(response, 200, { content: responseText(body) });
  } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Chat request failed.' }); }
});

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) server.listen(port, '127.0.0.1', () => console.log(`CampusAtlas API listening on http://127.0.0.1:${port}`));
