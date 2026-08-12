import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import express from 'express';

const app = express();
const port = 5270;
const storePath = join(process.cwd(), 'data', 'memory-store.json');
app.use(express.json({ limit: '50mb' }));

async function loadStore() {
  try {
    return JSON.parse(await readFile(storePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { documents: [], memories: [], sessions: [], deletedMessageIds: [] };
    throw error;
  }
}

async function saveStore(store) {
  await mkdir(dirname(storePath), { recursive: true });
  const temporary = `${storePath}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2));
  await rename(temporary, storePath);
}

function cleanCandidate(candidate, documentId, sourceMessageIds = []) {
  const kinds = new Set(['experience', 'skill', 'preference', 'viewpoint', 'language_sample']);
  return {
    id: randomUUID(),
    documentId,
    kind: kinds.has(candidate.kind) ? candidate.kind : 'experience',
    title: String(candidate.title || 'Untitled memory').slice(0, 80),
    content: String(candidate.content || '').slice(0, 800),
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(String).slice(0, 8) : [],
    sourceQuote: String(candidate.sourceQuote || '').slice(0, 500),
    sourceMessageIds,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

async function proposeWithDeepSeek(document) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured. Set it in the local .env file and restart the service.');

  const prompt = `You extract candidate memories from personal source material. Use only facts supported by the source; never invent details. Return strict JSON in this format: {"memories":[{"kind":"experience|skill|preference|viewpoint|language_sample","title":"short title","content":"clear complete candidate memory","tags":["tag"],"sourceQuote":"short direct source quote"}]}. Return at most 12 items. Return an empty array when no reliable information exists. Source material:\n${document.content.slice(0, 24000)}`;
  const response = await fetch(`${(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek extraction request failed (${response.status}).`);
  const payload = await response.json();
  const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
  return Array.isArray(parsed.memories) ? parsed.memories : [];
}

function approvedMemoryContext(store) {
  return store.memories.filter((memory) => memory.status === 'approved').slice(0, 24).map((memory) => `- ${memory.kind} | ${memory.title}: ${memory.content}`).join('\n');
}

async function streamDailyChat(session, store, response) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured. Set it in the local .env file and restart the service.');
  const system = `You are MindClone, a long-term conversational partner who helps the user think, organize experiences, and express themselves. Be natural, direct, and willing to make a judgment. Do not mechanically summarize or repeatedly say that you remembered something. When the user discusses experiences, preferences, viewpoints, or important changes, ask useful follow-up questions when appropriate. Treat only approved memories as known facts; never turn speculation into the user's experience. Reply in clear, natural English by default, and match the user's language when they write in another language.\n\nApproved memories:\n${approvedMemoryContext(store) || '(none yet)'}`;
  const upstream = await fetch(`${(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', temperature: 0.7, stream: true, messages: [{ role: 'system', content: system }, ...session.messages.slice(-24).map((message) => ({ role: message.role, content: message.content }))] }),
  });
  if (!upstream.ok || !upstream.body) throw new Error(`DeepSeek daily chat request failed (${upstream.status}).`);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let answer = '';
  let pending = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof delta === 'string') { answer += delta; response.write(`data: ${JSON.stringify({ delta })}\n\n`); }
      } catch { /* Ignore provider keep-alives. */ }
    }
  }
  return answer;
}

function removeMessageLinkedData(store, messageIds) {
  const ids = new Set(messageIds);
  store.deletedMessageIds = [...new Set([...(store.deletedMessageIds || []), ...messageIds])].slice(-10_000);
  const removedDocumentIds = new Set();
  store.documents = store.documents.filter((document) => {
    const linked = (document.sourceMessageIds || []).some((id) => ids.has(id));
    if (linked) removedDocumentIds.add(document.id);
    return !linked;
  });
  store.memories = store.memories.filter((memory) =>
    !removedDocumentIds.has(memory.documentId) && !(memory.sourceMessageIds || []).some((id) => ids.has(id)),
  );
}

app.get('/api/health', (_, response) => response.json({ status: 'ok' }));
app.get('/api/memory', async (_, response, next) => {
  try { response.json(await loadStore()); } catch (error) { next(error); }
});
app.post('/api/memory/documents', async (request, response, next) => {
  try {
    const { title, sourceType, content } = request.body;
    if (!title || !content || !['chatgpt_export', 'note', 'conversation'].includes(sourceType)) {
      return response.status(400).json({ error: 'The imported material is incomplete or has an invalid source type.' });
    }
    const document = { id: randomUUID(), title: String(title).slice(0, 120), sourceType, content: String(content).slice(0, 2_000_000), createdAt: new Date().toISOString() };
    const store = await loadStore();
    store.documents.unshift(document);
    await saveStore(store);
    response.status(201).json({ document });
  } catch (error) { next(error); }
});
app.post('/api/memory/extract', async (request, response, next) => {
  try {
    const store = await loadStore();
    const document = store.documents.find((item) => item.id === request.body.documentId);
    if (!document) return response.status(404).json({ error: 'Source material was not found.' });
    const proposed = await proposeWithDeepSeek(document);
    const memories = proposed.map((candidate) => cleanCandidate(candidate, document.id)).filter((candidate) => candidate.content);
    store.memories.unshift(...memories);
    document.extractedAt = new Date().toISOString();
    await saveStore(store);
    response.json({ memories });
  } catch (error) { next(error); }
});
app.patch('/api/memory/candidates/:id', async (request, response, next) => {
  try {
    if (!['approved', 'rejected', 'pending'].includes(request.body.status)) return response.status(400).json({ error: 'Invalid review status.' });
    const store = await loadStore();
    const memory = store.memories.find((item) => item.id === request.params.id);
    if (!memory) return response.status(404).json({ error: 'Candidate memory was not found.' });
    memory.status = request.body.status;
    await saveStore(store);
    response.json({ memory });
  } catch (error) { next(error); }
});
app.get('/api/chat/sessions', async (_, response, next) => {
  try { const store = await loadStore(); response.json({ sessions: store.sessions || [] }); } catch (error) { next(error); }
});
app.post('/api/chat/sessions', async (_, response, next) => {
  try {
    const store = await loadStore();
    const now = new Date().toISOString();
    const session = { id: randomUUID(), title: 'New conversation', createdAt: now, updatedAt: now, messages: [] };
    store.sessions = store.sessions || [];
    store.sessions.unshift(session);
    await saveStore(store);
    response.status(201).json({ session });
  } catch (error) { next(error); }
});
app.post('/api/chat/sessions/:id/stream', async (request, response, next) => {
  try {
    const content = String(request.body.content || '').trim();
    if (!content) return response.status(400).json({ error: 'A message is required.' });
    const store = await loadStore();
    const session = (store.sessions || []).find((item) => item.id === request.params.id);
    if (!session) return response.status(404).json({ error: 'Conversation was not found.' });
    const replaceFromMessageId = request.body.replaceFromMessageId;
    if (replaceFromMessageId) {
      const position = session.messages.findIndex((message) => message.id === replaceFromMessageId);
      if (position < 0) return response.status(404).json({ error: 'The message to edit was not found.' });
      const removedIds = session.messages.slice(position).map((message) => message.id);
      session.messages = session.messages.slice(0, position);
      removeMessageLinkedData(store, removedIds);
    }
    const now = new Date().toISOString();
    session.messages.push({ id: randomUUID(), role: 'user', content, createdAt: now });
    if (session.messages.filter((message) => message.role === 'user').length === 1) session.title = content.slice(0, 28);
    session.updatedAt = now;
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    const answer = await streamDailyChat(session, store, response);
    if (answer) session.messages.push({ id: randomUUID(), role: 'assistant', content: answer, createdAt: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    const recentMessages = session.messages.slice(-2);
    const shouldExtract = recentMessages[0]?.content.length >= 60 || /experience|project|work|startup|like|dislike|values|strength|learn|decision|goal/i.test(recentMessages[0]?.content || '');
    if (shouldExtract) {
      const document = { id: randomUUID(), title: `Daily chat: ${session.title}`, sourceType: 'conversation', content: recentMessages.map((message) => `${message.role === 'user' ? 'User' : 'MindClone'}: ${message.content}`).join('\n\n'), sourceMessageIds: recentMessages.map((message) => message.id), createdAt: new Date().toISOString() };
      store.documents.unshift(document);
      proposeWithDeepSeek(document).then(async (proposed) => {
        const latest = await loadStore();
        const deletedIds = new Set(latest.deletedMessageIds || []);
        if (document.sourceMessageIds.some((id) => deletedIds.has(id))) return;
        if (!latest.documents.some((item) => item.id === document.id)) return;
        latest.memories.unshift(...proposed.map((candidate) => cleanCandidate(candidate, document.id, document.sourceMessageIds)).filter((candidate) => candidate.content));
        const latestDocument = latest.documents.find((item) => item.id === document.id);
        if (latestDocument) latestDocument.extractedAt = new Date().toISOString();
        await saveStore(latest);
      }).catch((error) => console.error('Daily memory extraction failed:', error.message));
    }
    await saveStore(store);
    response.write('data: [DONE]\n\n');
    response.end();
  } catch (error) { next(error); }
});
app.delete('/api/chat/sessions/:id', async (request, response, next) => {
  try {
    const store = await loadStore();
    const session = (store.sessions || []).find((item) => item.id === request.params.id);
    if (!session) return response.status(404).json({ error: 'Conversation was not found.' });
    removeMessageLinkedData(store, session.messages.map((message) => message.id));
    store.sessions = store.sessions.filter((item) => item.id !== session.id);
    await saveStore(store);
    response.status(204).end();
  } catch (error) { next(error); }
});
app.use((error, _, response, __) => {
  console.error(error);
  response.status(500).json({ error: error.message || 'The local memory service encountered an unknown error.' });
});
app.listen(port, '127.0.0.1', () => console.log(`MindClone memory API listening on http://127.0.0.1:${port}`));
