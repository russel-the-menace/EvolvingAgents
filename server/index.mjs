import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 5270);
const storePath = join(process.cwd(), 'data', 'memory-store.json');
const execFileAsync = promisify(execFile);
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
  const personalKinds = new Set(['experience', 'skill', 'preference', 'viewpoint', 'language_sample']);
  const learningKinds = new Set(['concept', 'framework', 'answer_pattern', 'case_example']);
  const scope = candidate.scope === 'learning' ? 'learning' : 'personal';
  return {
    id: randomUUID(),
    documentId,
    kind: (scope === 'learning' ? learningKinds : personalKinds).has(candidate.kind) ? candidate.kind : scope === 'learning' ? 'concept' : 'experience',
    scope,
    title: String(candidate.title || 'Untitled memory').slice(0, 80),
    content: String(candidate.content || '').slice(0, 800),
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(String).slice(0, 8) : [],
    sourceQuote: String(candidate.sourceQuote || '').slice(0, 500),
    sourceMessageIds,
    status: scope === 'learning' ? 'approved' : 'pending',
    createdAt: new Date().toISOString(),
  };
}

async function proposeWithDeepSeek(document) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured. Set it in the local .env file and restart the service.');

  const learningSource = document.sourceType === 'short_video';
  const prompt = learningSource
    ? `You extract reusable learning knowledge from a video transcript. This is not the user's personal history. Never describe a speaker's experience, claims, preferences, or cases as the user's experience. Return strict JSON in this format: {"memories":[{"scope":"learning","kind":"concept|framework|answer_pattern|case_example","title":"short title","content":"clear, reusable knowledge in Chinese","tags":["tag"],"sourceQuote":"short direct source quote"}]}. Capture core concepts, reasoning frameworks, and answer patterns. When the speaker gives a case, label it as a third-party example. Return at most 10 items. Source material:\n${document.content.slice(0, 24000)}`
    : `You extract candidate memories from personal source material. Use only facts supported by the source; never invent details. Return strict JSON in this format: {"memories":[{"scope":"personal","kind":"experience|skill|preference|viewpoint|language_sample","title":"short title","content":"clear complete candidate memory","tags":["tag"],"sourceQuote":"short direct source quote"}]}. Return at most 12 items. Return an empty array when no reliable information exists. Source material:\n${document.content.slice(0, 24000)}`;
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

const stopWords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what', 'when', 'where', 'with', 'you', 'your']);

function tokenize(value) {
  const text = String(value || '').toLowerCase();
  const words = text.match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const ideographs = text.match(/\p{Script=Han}/gu) || [];
  const bigrams = ideographs.slice(0, -1).map((character, index) => `${character}${ideographs[index + 1]}`);
  return [...new Set([...words.filter((word) => !stopWords.has(word)), ...bigrams])].slice(0, 40);
}

function relevance(queryTokens, value) {
  if (!queryTokens.length) return 0;
  const haystack = String(value || '').toLowerCase();
  return queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function clip(value, length = 720) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function extractDouyinShare(shareText) {
  const text = String(shareText || '').trim();
  const match = text.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?/i);
  if (!match) throw new Error('Paste a Douyin share message containing a v.douyin.com link.');
  const withoutLink = text.replace(match[0], '').replace(/复制此链接[，,]?\s*打开Dou音搜索[，,]?\s*直接观看视频！?/gi, '').trim();
  const titleMatch = withoutLink.match(/[:：]\s*([^#\n]{4,120})/);
  const titleSource = titleMatch?.[1] || withoutLink.split(/[#\n]/)[0] || 'Douyin learning material';
  const firstChineseCharacter = titleSource.search(/\p{Script=Han}/u);
  const title = titleSource.slice(firstChineseCharacter >= 0 ? firstChineseCharacter : 0).trim().replace(/[。！!]+$/, '');
  const tags = [...withoutLink.matchAll(/#\s*([^#\s]+)/g)].map((item) => item[1]).slice(0, 12);
  return { sourceUrl: match[0], title: title.slice(0, 120), shareText: text, tags };
}

async function resolveDouyinLink(sourceUrl) {
  let current = sourceUrl;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const url = new URL(current);
    if (url.protocol !== 'https:' || !(url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com'))) throw new Error('The shared link redirected outside Douyin and was not followed.');
    const result = await fetch(current, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 MindClone/0.1' }, signal: AbortSignal.timeout(8_000) });
    if (result.status < 300 || result.status >= 400) return current;
    const next = result.headers.get('location');
    if (!next) return current;
    current = new URL(next, current).toString();
  }
  return current;
}

function findMediaUrl(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) { const found = findMediaUrl(item, seen); if (found) return found; }
    return null;
  }
  const preferredKeys = ['play_addr', 'play_url', 'download_addr', 'download_url', 'video_url', 'url_list', 'url'];
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
    if (Array.isArray(candidate)) {
      const url = candidate.find((item) => typeof item === 'string' && /^https?:\/\//i.test(item));
      if (url) return url;
    }
    if (candidate && typeof candidate === 'object') { const found = findMediaUrl(candidate, seen); if (found) return found; }
  }
  for (const candidate of Object.values(value)) { const found = findMediaUrl(candidate, seen); if (found) return found; }
  return null;
}

function findPlaybackUrl(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) { const found = findPlaybackUrl(item, seen); if (found) return found; }
    return null;
  }
  if (value.play_addr) {
    const found = findMediaUrl(value.play_addr);
    if (found) return found;
  }
  for (const candidate of Object.values(value)) { const found = findPlaybackUrl(candidate, seen); if (found) return found; }
  return null;
}

async function fetchTikHubVideo(shareText) {
  const token = process.env.TIKHUB_API_KEY;
  if (!token) throw new Error('TIKHUB_API_KEY is not configured. Add it to the local .env file and restart the service.');
  const baseUrl = (process.env.TIKHUB_BASE_URL || 'https://api.tikhub.dev').replace(/\/$/, '');
  const url = new URL('/api/v1/hybrid/video_data', baseUrl);
  url.searchParams.set('url', shareText);
  url.searchParams.set('minimal', 'false');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 200) throw new Error(payload.message_zh || payload.message || `TikHub video parsing failed (${response.status}).`);
  const mediaUrl = findPlaybackUrl(payload.data) || findMediaUrl(payload.data);
  if (!mediaUrl) throw new Error('TikHub returned video data but no downloadable media URL.');
  return { data: payload.data, mediaUrl };
}

async function transcribeShortVideo(shareText) {
  const whisperModel = process.env.WHISPER_MODEL_PATH || join(process.cwd(), 'models', 'whisper', 'ggml-small.bin');
  try { await readFile(whisperModel); } catch { throw new Error(`Local Whisper model was not found at ${whisperModel}. Run the setup command or set WHISPER_MODEL_PATH.`); }
  const { mediaUrl, data } = await fetchTikHubVideo(shareText);
  const directory = await mkdtemp(join(tmpdir(), 'mindclone-transcript-'));
  const mediaPath = join(directory, 'source-media');
  const audioPath = join(directory, 'speech.wav');
  try {
    const media = await fetch(mediaUrl, { headers: { 'User-Agent': 'Mozilla/5.0 MindClone/0.1' }, signal: AbortSignal.timeout(120_000) });
    if (!media.ok || !media.body) throw new Error(`Media download failed (${media.status}).`);
    const bytes = Buffer.from(await media.arrayBuffer());
    if (bytes.length > 200 * 1024 * 1024) throw new Error('The source video exceeds the 200 MB transcription limit.');
    await writeFile(mediaPath, bytes);
    await execFileAsync('ffmpeg', ['-y', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath], { timeout: 120_000 });
    const outputBase = join(directory, 'transcript');
    const threads = String(Math.max(1, Math.min(Number(process.env.WHISPER_THREADS || 4), 12)));
    await execFileAsync(process.env.WHISPER_CLI_PATH || 'whisper-cli', ['-m', whisperModel, '-f', audioPath, '-l', 'zh', '-otxt', '-of', outputBase, '-t', threads, '-np'], { timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    const transcript = (await readFile(`${outputBase}.txt`, 'utf8')).trim();
    if (!transcript) throw new Error('Local Whisper returned an empty transcript.');
    return { transcript, videoData: data };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function relevantMemoryContext(store, currentSession, query) {
  const queryTokens = tokenize(query);
  const approved = store.memories
    .filter((memory) => memory.status === 'approved')
    .sort((left, right) => relevance(queryTokens, `${right.title} ${right.content} ${right.tags.join(' ')}`) - relevance(queryTokens, `${left.title} ${left.content} ${left.tags.join(' ')}`))
    .slice(0, 10);

  const personalMemories = approved.filter((memory) => memory.scope !== 'learning').map((memory) => `- ${memory.kind}: ${clip(memory.content, 360)}`);
  const learnedKnowledge = approved.filter((memory) => memory.scope === 'learning').map((memory) => `- ${memory.kind}: ${clip(memory.content, 360)}`);
  const candidates = store.memories
    .filter((memory) => memory.status === 'pending' && memory.scope !== 'learning')
    .map((memory) => ({
      score: relevance(queryTokens, `${memory.title} ${memory.content} ${memory.tags.join(' ')}`),
      text: `- ${memory.kind}: ${clip(memory.content, 360)}`,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map((item) => item.text);

  const documents = store.documents
    .map((document) => ({
      score: relevance(queryTokens, `${document.title} ${document.content}`),
      text: `- ${document.title}: ${clip(document.content, 520)}`,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.text);

  const pastTurns = (store.sessions || [])
    .filter((session) => session.id !== currentSession.id)
    .flatMap((session) => session.messages.reduce((turns, message, index, messages) => {
      if (message.role !== 'user') return turns;
      const reply = messages[index + 1]?.role === 'assistant' ? messages[index + 1].content : '';
      const text = `User: ${clip(message.content, 320)}${reply ? `\nMindClone: ${clip(reply, 400)}` : ''}`;
      turns.push({ score: relevance(queryTokens, text), text });
      return turns;
    }, []))
    .filter((turn) => turn.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((turn) => `- ${turn.text}`);

  const sections = [];
  if (personalMemories.length) sections.push(`Reliable personal memories. These are facts about the user:\n${personalMemories.join('\n')}`);
  if (learnedKnowledge.length) sections.push(`Learned knowledge. Use this to reason and explain, but do not present its source author's experience as the user's own:\n${learnedKnowledge.join('\n')}`);
  if (candidates.length) sections.push(`Unverified extracted memories. Use these only as leads; do not present them as established facts without support from the conversation:\n${candidates.join('\n')}`);
  if (documents.length) sections.push(`Relevant imported material:\n${documents.join('\n')}`);
  if (pastTurns.length) sections.push(`Relevant past conversation turns:\n${pastTurns.join('\n')}`);
  return sections.join('\n\n');
}

async function streamDailyChat(session, store, response, query, model) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured. Set it in the local .env file and restart the service.');
  const memoryContext = relevantMemoryContext(store, session, query);
  const system = `You are MindClone, a long-term conversational partner who helps the user think, organize experiences, and express themselves. Be natural, direct, and willing to make a judgment. Do not mechanically summarize or repeatedly say that you remembered something. When the user discusses experiences, preferences, viewpoints, or important changes, ask useful follow-up questions when appropriate. Treat reliable memories as known context, but never turn unverified material or speculation into the user's experience. Reply in clear, natural English by default, and match the user's language when they write in another language.\n\n${memoryContext || 'No relevant long-term context has been retrieved yet.'}`;
  const modelOptions = {
    'deepseek-light': { model: 'deepseek-v4-flash', thinking: false },
    'deepseek-medium': { model: 'deepseek-v4-flash', thinking: true },
    'deepseek-high': { model: 'deepseek-v4-pro', thinking: false },
    'deepseek-ultra': { model: 'deepseek-v4-pro', thinking: true },
  };
  const selectedModel = modelOptions[model] || modelOptions['deepseek-light'];
  const upstream = await fetch(`${(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: selectedModel.model, stream: true, thinking: { type: selectedModel.thinking ? 'enabled' : 'disabled' }, ...(selectedModel.thinking ? { reasoning_effort: 'high' } : { temperature: 0.7 }), messages: [{ role: 'system', content: system }, ...session.messages.slice(-24).map((message) => ({ role: message.role, content: message.content }))] }),
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
    if (!title || !content || !['chatgpt_export', 'note', 'conversation', 'short_video'].includes(sourceType)) {
      return response.status(400).json({ error: 'The imported material is incomplete or has an invalid source type.' });
    }
    const document = { id: randomUUID(), title: String(title).slice(0, 120), sourceType, content: String(content).slice(0, 2_000_000), createdAt: new Date().toISOString() };
    const store = await loadStore();
    store.documents.unshift(document);
    await saveStore(store);
    response.status(201).json({ document });
  } catch (error) { next(error); }
});
app.post('/api/memory/short-videos/prepare', async (request, response, next) => {
  try {
    const parsed = extractDouyinShare(request.body.shareText);
    let sourceUrl = parsed.sourceUrl;
    try { sourceUrl = await resolveDouyinLink(sourceUrl); } catch (error) { console.warn('Douyin link resolution skipped:', error.message); }
    const lines = [
      `Source platform: Douyin`,
      `Source link: ${sourceUrl}`,
      `Original share text: ${parsed.shareText}`,
      parsed.tags.length ? `Topics: ${parsed.tags.join(', ')}` : '',
      '',
      'Voice transcript:',
      'Add or correct the spoken transcript here before saving. MindClone learns from text only and does not analyze video frames or subtitles.',
    ].filter(Boolean);
    response.json({ title: parsed.title, sourceUrl, content: lines.join('\n') });
  } catch (error) { next(error); }
});
app.post('/api/memory/short-videos/transcribe', async (request, response, next) => {
  try {
    const parsed = extractDouyinShare(request.body.shareText);
    const { transcript } = await transcribeShortVideo(parsed.shareText);
    const lines = [
      'Source platform: Douyin',
      `Source link: ${parsed.sourceUrl}`,
      `Original share text: ${parsed.shareText}`,
      parsed.tags.length ? `Topics: ${parsed.tags.join(', ')}` : '',
      '',
      'Voice transcript:',
      transcript,
    ].filter(Boolean);
    response.json({ title: parsed.title, sourceUrl: parsed.sourceUrl, content: lines.join('\n') });
  } catch (error) { next(error); }
});
app.post('/api/memory/extract', async (request, response, next) => {
  try {
    const store = await loadStore();
    const document = store.documents.find((item) => item.id === request.body.documentId);
    if (!document) return response.status(404).json({ error: 'Source material was not found.' });
    const proposed = await proposeWithDeepSeek(document);
    store.memories = store.memories.filter((memory) => memory.documentId !== document.id);
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
app.patch('/api/chat/sessions/:id', async (request, response, next) => {
  try {
    const store = await loadStore();
    const session = (store.sessions || []).find((item) => item.id === request.params.id);
    if (!session) return response.status(404).json({ error: 'Conversation was not found.' });
    if (typeof request.body.title === 'string') {
      const title = request.body.title.trim();
      if (!title) return response.status(400).json({ error: 'A conversation title is required.' });
      session.title = title.slice(0, 120);
    }
    if (typeof request.body.pinned === 'boolean') session.pinned = request.body.pinned;
    session.updatedAt = new Date().toISOString();
    store.sessions.sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    await saveStore(store);
    response.json({ session });
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
    const answer = await streamDailyChat(session, store, response, content, request.body.model);
    if (answer) session.messages.push({ id: randomUUID(), role: 'assistant', content: answer, createdAt: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    const recentMessages = session.messages.slice(-2);
    const document = { id: randomUUID(), title: `Daily chat: ${session.title}`, sourceType: 'conversation', content: recentMessages.map((message) => `${message.role === 'user' ? 'User' : 'MindClone'}: ${message.content}`).join('\n\n'), sourceMessageIds: recentMessages.map((message) => message.id), createdAt: new Date().toISOString() };
    store.documents.unshift(document);
    await saveStore(store);
    response.write('data: [DONE]\n\n');
    response.end();
    void proposeWithDeepSeek(document).then(async (proposed) => {
      const latest = await loadStore();
      const deletedIds = new Set(latest.deletedMessageIds || []);
      if (document.sourceMessageIds.some((id) => deletedIds.has(id))) return;
      if (!latest.documents.some((item) => item.id === document.id)) return;
      latest.memories.unshift(...proposed.map((candidate) => cleanCandidate(candidate, document.id, document.sourceMessageIds)).filter((candidate) => candidate.content));
      const latestDocument = latest.documents.find((item) => item.id === document.id);
      if (latestDocument) latestDocument.extractedAt = new Date().toISOString();
      await saveStore(latest);
    }).catch((error) => console.error('Daily memory extraction failed:', error.message));
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
