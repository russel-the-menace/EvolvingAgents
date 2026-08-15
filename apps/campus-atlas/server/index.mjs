import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteLearningStore } from '@evolving-agents/learning-engine';
import { createCompetitionPlanningEngine } from '../src/learning.mjs';

const port = Number(process.env.CAMPUS_ATLAS_API_PORT || 5445);
const gatewayBaseUrl = (process.env.GATEWAY_BASE_URL || 'https://feiwan.online').replace(/\/$/, '');
const gatewayApiKey = process.env.GATEWAY_API_KEY || 'yeatom';
const databasePath = process.env.CAMPUS_ATLAS_DB || 'data/campus-atlas.sqlite';
mkdirSync(databasePath.slice(0, databasePath.lastIndexOf('/')) || '.', { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON;');
const store = createSqliteLearningStore(db);
const knowledgeEngine = createCompetitionPlanningEngine({ store, extractor: { async extract({ source }) { return source.metadata.proposals || []; } } });

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
  if (request.method === 'POST' && request.url === '/api/knowledge/ingest') {
    try {
      const payload = await requestBody(request);
      if (!payload.title || !payload.content || !Array.isArray(payload.proposals)) throw new Error('title, content, and proposals are required.');
      const metadata = { ...(payload.metadata || {}), proposals: payload.proposals };
      const ingested = await knowledgeEngine.ingest({ title: payload.title, content: payload.content, sourceType: payload.sourceType || 'manual_competition', sourceUri: payload.sourceUri, sourceActor: payload.sourceActor, metadata });
      const learned = await knowledgeEngine.learn(ingested.source.id);
      return sendJson(response, 200, { source: learned.source, claims: learned.claims });
    } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Knowledge ingestion failed.' }); }
  }
  if (request.method === 'POST' && request.url === '/api/knowledge/retrieve') {
    try {
      const payload = await requestBody(request);
      if (!String(payload.query || '').trim()) throw new Error('query is required.');
      const results = await knowledgeEngine.retrieve(payload.query, { now: payload.now, limit: payload.limit || 12, context: { accessScopes: payload.accessScopes || ['public'] } });
      return sendJson(response, 200, { results, evidence: knowledgeEngine.buildEvidenceContext(results) });
    } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Knowledge retrieval failed.' }); }
  }
  if (request.method !== 'POST' || request.url !== '/api/chat') return sendJson(response, 404, { error: 'Not found.' });
  if (!gatewayBaseUrl || !gatewayApiKey) return sendJson(response, 503, { error: 'Gateway is not configured. Set GATEWAY_BASE_URL and GATEWAY_API_KEY in .env.' });
  try {
    const { messages, quality = process.env.DEEPSEEK_QUALITY || 'Medium' } = await requestBody(request);
    if (!Array.isArray(messages) || !messages.length || !messages.every((message) => ['user', 'assistant', 'system'].includes(message.role) && typeof message.content === 'string')) throw new Error('Messages must be a non-empty OpenAI-style message list.');
    if (!['Medium', 'High'].includes(quality)) throw new Error('Quality must be Medium or High.');
    const upstream = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${gatewayApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'deepseek', quality, messages }), signal: AbortSignal.timeout(120_000) });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return sendJson(response, upstream.status, { error: body.error?.message || body.error || 'Gateway request failed.' });
    return sendJson(response, 200, { content: responseText(body) });
  } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Chat request failed.' }); }
});

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) server.listen(port, '127.0.0.1', () => console.log(`CampusAtlas API listening on http://127.0.0.1:${port}`));
