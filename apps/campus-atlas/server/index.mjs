import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteLearningStore, parseModelJson } from '@evolving-agents/learning-engine';
import { createCompetitionPlanningEngine } from '../src/learning.mjs';
import { createChatHistoryStore } from '@evolving-agents/chat-history';
import { createModelGateway } from '@evolving-agents/model-gateway';
import { createChatRuntime } from '@evolving-agents/chat-runtime';

const port = Number(process.env.CAMPUS_ATLAS_API_PORT || 5445);
const gatewayBaseUrl = (process.env.GATEWAY_BASE_URL || 'https://feiwan.online').replace(/\/$/, '');
const gatewayApiKey = process.env.GATEWAY_API_KEY || 'yeatom';
const gateway = createModelGateway({ baseUrl: gatewayBaseUrl, apiKey: gatewayApiKey });
const databasePath = process.env.CAMPUS_ATLAS_DB || 'data/campus-atlas.sqlite';
mkdirSync(databasePath.slice(0, databasePath.lastIndexOf('/')) || '.', { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON;');
const store = createSqliteLearningStore(db);
const chatHistory = createChatHistoryStore(db);
const chatRuntime = createChatRuntime(chatHistory);
const knowledgeEngine = createCompetitionPlanningEngine({ store, extractor: { async extract({ source }) { return source.metadata.proposals || []; } } });

export function planningPrompt(question, evidence) {
  return `你是 CampusAtlas 的大学生竞赛规划助手。只能根据下方已检索到的证据回答，不要把推测写成事实。输出：1) 推荐的竞赛时间表；2) 每项准备任务和截止日期；3) 每项建议对应的证据引用；4) 信息不足或冲突时列出待确认问题。区分“官方事实”“用户资料”和“模型建议”。\n\n用户目标：${question}\n\n证据：\n${JSON.stringify(evidence).slice(0, 60000)}`;
}

function chatEvidencePrompt(evidence) {
  return `你是 CampusAtlas。回答必须优先使用下方检索证据；证据为空时明确说明资料不足，不要编造竞赛、日期或资格条件。涉及竞赛规划时，输出时间表、准备任务、证据引用和待确认问题，并区分官方事实、用户资料和模型建议。\n\n检索证据：\n${JSON.stringify(evidence).slice(0, 60000)}`;
}

export function parseJsonResponse(content) {
  return parseModelJson(content);
}

function extractionPrompt(title, content) {
  return `从下面的竞赛资料中抽取事实 claims，只返回 JSON 数组。每项必须有 title、proposition、kind、sourceQuote、tags、validFrom、validTo、confidence。不要补充资料中不存在的日期或资格条件。\n标题：${title}\n资料：${content.slice(0, 50000)}`;
}

export function shouldLearnConversation(text) {
  return String(text || '').length >= 80 && /(记住|资料|竞赛|比赛|报名截止|我的技能|我的时间|我的兴趣)/u.test(text);
}

async function callGateway(messages, quality = 'Medium') {
  return gateway.complete(messages, { quality });
}

function sendJson(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }
function sendEvent(response, body) { response.write(`data: ${typeof body === 'string' ? body : JSON.stringify(body)}\n\n`); }

async function requestBody(request) {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 1_000_000) throw new Error('Request body is too large.'); }
  return JSON.parse(raw);
}

async function createCampusAnswer(messages, quality, stream) {
  if (!Array.isArray(messages) || !messages.length || !messages.every((message) => ['user', 'assistant', 'system'].includes(message.role) && typeof message.content === 'string')) throw new Error('Messages must be a non-empty OpenAI-style message list.');
  if (!['Medium', 'High'].includes(quality)) throw new Error('Quality must be Medium or High.');
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  if (latestUser && shouldLearnConversation(latestUser.content)) {
    try {
      const privateProfile = /(我的技能|我的时间|我的兴趣|我每周|我的背景)/u.test(latestUser.content);
      const title = `${privateProfile ? '对话中的个人资料' : '对话中的竞赛资料'} ${new Date().toISOString().slice(0, 10)}`;
      const proposals = parseJsonResponse(await callGateway([{ role: 'system', content: 'You extract conservative structured competition facts or user profile constraints.' }, { role: 'user', content: extractionPrompt(title, latestUser.content) }], quality));
      if (Array.isArray(proposals) && proposals.length) {
        const ingested = await knowledgeEngine.ingest({ title, content: latestUser.content, sourceType: privateProfile ? 'conversation_profile' : 'conversation_competition', sourceActor: privateProfile ? 'user' : 'conversation', metadata: { domain: privateProfile ? 'user_profile' : 'competition', accessScope: privateProfile ? 'private_profile' : 'public', proposals } });
        await knowledgeEngine.learn(ingested.source.id);
      }
    } catch (error) { console.error('Conversation learning skipped:', error instanceof Error ? error.message : error); }
  }
  const results = latestUser ? await knowledgeEngine.retrieve(latestUser.content, { limit: 20, context: { accessScopes: ['public', 'private_profile'] } }) : [];
  const evidence = knowledgeEngine.buildEvidenceContext(results);
  const gatewayMessages = [{ role: 'system', content: chatEvidencePrompt(evidence) }, ...messages];
  stream?.onReady();
  const content = stream ? await gateway.stream(gatewayMessages, { quality, onDelta: stream.onDelta }) : await callGateway(gatewayMessages, quality);
  return { content, evidence };
}

const server = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/chat/sessions/import') {
    try {
      const { sessions } = await requestBody(request);
      if (!Array.isArray(sessions) || sessions.length > 500) throw new Error('sessions must be an array with at most 500 items.');
      for (const item of sessions) {
        if (!item?.id || !item?.title || !Array.isArray(item.messages) || chatHistory.getSession(item.id)) continue;
        const session = chatHistory.createSession({ id: String(item.id), title: String(item.title).slice(0, 160), pinned: Boolean(item.pinned) });
        for (const message of item.messages.slice(0, 2000)) if (['user', 'assistant'].includes(message?.role) && typeof (message.content ?? message.text) === 'string') chatHistory.addMessage(session.id, { ...(message.id ? { id: String(message.id) } : {}), ...(message.createdAt ? { createdAt: String(message.createdAt) } : {}), role: message.role, content: message.content ?? message.text });
      }
      return sendJson(response, 200, { sessions: chatHistory.listSessions() });
    } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Session import failed.' }); }
  }
  if (request.method === 'GET' && request.url === '/api/chat/sessions') return sendJson(response, 200, { sessions: chatHistory.listSessions() });
  if (request.method === 'POST' && request.url === '/api/chat/sessions') return sendJson(response, 201, { session: chatHistory.createSession() });
  const sessionRoute = request.url?.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  if (sessionRoute && request.method === 'PATCH') {
    const session = chatHistory.updateSession(sessionRoute[1], await requestBody(request));
    return sendJson(response, session ? 200 : 404, session ? { session } : { error: 'Conversation was not found.' });
  }
  if (sessionRoute && request.method === 'DELETE') { chatHistory.deleteSession(sessionRoute[1]); response.writeHead(204); return response.end(); }
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
  const streamingChat = request.method === 'POST' && request.url === '/api/chat/stream';
  if (request.method !== 'POST' || (!streamingChat && request.url !== '/api/chat')) return sendJson(response, 404, { error: 'Not found.' });
  if (!gatewayBaseUrl || !gatewayApiKey) return sendJson(response, 503, { error: 'Gateway is not configured. Set GATEWAY_BASE_URL and GATEWAY_API_KEY in .env.' });
  try {
    const { sessionId, content, quality = process.env.DEEPSEEK_QUALITY || 'Medium' } = await requestBody(request);
    const stream = streamingChat ? {
      onReady: () => response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }),
      onDelta: (delta) => sendEvent(response, { delta }),
    } : null;
    const result = await chatRuntime.run({ sessionId, content, createAnswer: ({ messages }) => createCampusAnswer(messages, quality, stream) });
    if (streamingChat) { sendEvent(response, '[DONE]'); return response.end(); }
    return sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat request failed.';
    if (response.headersSent) { sendEvent(response, { error: message }); sendEvent(response, '[DONE]'); return response.end(); }
    return sendJson(response, error.status || 400, { error: message });
  }
});

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) server.listen(port, '127.0.0.1', () => console.log(`CampusAtlas API listening on http://127.0.0.1:${port}`));
