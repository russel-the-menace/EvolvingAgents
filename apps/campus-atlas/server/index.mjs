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

export function planningPrompt(question, evidence) {
  return `你是 CampusAtlas 的大学生竞赛规划助手。只能根据下方已检索到的证据回答，不要把推测写成事实。输出：1) 推荐的竞赛时间表；2) 每项准备任务和截止日期；3) 每项建议对应的证据引用；4) 信息不足或冲突时列出待确认问题。区分“官方事实”“用户资料”和“模型建议”。\n\n用户目标：${question}\n\n证据：\n${JSON.stringify(evidence).slice(0, 60000)}`;
}

export function parseJsonResponse(content) {
  const cleaned = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

function extractionPrompt(title, content) {
  return `从下面的竞赛资料中抽取事实 claims，只返回 JSON 数组。每项必须有 title、proposition、kind、sourceQuote、tags、validFrom、validTo、confidence。不要补充资料中不存在的日期或资格条件。\n标题：${title}\n资料：${content.slice(0, 50000)}`;
}

async function callGateway(messages, quality = 'Medium') {
  const upstream = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${gatewayApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'deepseek', quality, messages }), signal: AbortSignal.timeout(120_000) });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) { const error = new Error(body.error?.message || body.error || 'Gateway request failed.'); error.status = upstream.status; throw error; }
  return responseText(body);
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
      if (!payload.title || !payload.content) throw new Error('title and content are required.');
      const proposals = Array.isArray(payload.proposals) ? payload.proposals : parseJsonResponse(await callGateway([{ role: 'system', content: 'You extract conservative structured competition facts.' }, { role: 'user', content: extractionPrompt(payload.title, payload.content) }], payload.quality || 'High'));
      if (!Array.isArray(proposals)) throw new Error('DeepSeek extraction must return a JSON array.');
      const metadata = { ...(payload.metadata || {}), proposals };
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
  if (request.method === 'POST' && request.url === '/api/plan') {
    try {
      const payload = await requestBody(request);
      if (!String(payload.question || '').trim()) throw new Error('question is required.');
      const results = await knowledgeEngine.retrieve(payload.question, { now: payload.now, limit: 20, context: { accessScopes: payload.accessScopes || ['public', 'private_profile'] } });
      const evidence = knowledgeEngine.buildEvidenceContext(results);
      const plan = await callGateway([{ role: 'system', content: 'You produce evidence-grounded university competition plans.' }, { role: 'user', content: planningPrompt(payload.question, evidence) }], payload.quality || 'High');
      return sendJson(response, 200, { plan, evidence });
    } catch (error) { return sendJson(response, error.status || 400, { error: error instanceof Error ? error.message : 'Planning request failed.' }); }
  }
  if (request.method !== 'POST' || request.url !== '/api/chat') return sendJson(response, 404, { error: 'Not found.' });
  if (!gatewayBaseUrl || !gatewayApiKey) return sendJson(response, 503, { error: 'Gateway is not configured. Set GATEWAY_BASE_URL and GATEWAY_API_KEY in .env.' });
  try {
    const { messages, quality = process.env.DEEPSEEK_QUALITY || 'Medium' } = await requestBody(request);
    if (!Array.isArray(messages) || !messages.length || !messages.every((message) => ['user', 'assistant', 'system'].includes(message.role) && typeof message.content === 'string')) throw new Error('Messages must be a non-empty OpenAI-style message list.');
    if (!['Medium', 'High'].includes(quality)) throw new Error('Quality must be Medium or High.');
    return sendJson(response, 200, { content: await callGateway(messages, quality) });
  } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Chat request failed.' }); }
});

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) server.listen(port, '127.0.0.1', () => console.log(`CampusAtlas API listening on http://127.0.0.1:${port}`));
