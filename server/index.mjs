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
    if (error.code === 'ENOENT') return { documents: [], memories: [] };
    throw error;
  }
}

async function saveStore(store) {
  await mkdir(dirname(storePath), { recursive: true });
  const temporary = `${storePath}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2));
  await rename(temporary, storePath);
}

function cleanCandidate(candidate, documentId) {
  const kinds = new Set(['experience', 'skill', 'preference', 'viewpoint', 'language_sample']);
  return {
    id: randomUUID(),
    documentId,
    kind: kinds.has(candidate.kind) ? candidate.kind : 'experience',
    title: String(candidate.title || '未命名记忆').slice(0, 80),
    content: String(candidate.content || '').slice(0, 800),
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(String).slice(0, 8) : [],
    sourceQuote: String(candidate.sourceQuote || '').slice(0, 500),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

async function proposeWithDeepSeek(document) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY。请在本地 .env 中设置后重启服务。');

  const prompt = `你是个人经历整理助手。仅从原始材料中提取候选记忆，绝不补造事实。
输出严格 JSON，格式：{"memories":[{"kind":"experience|skill|preference|viewpoint|language_sample","title":"不超过20字","content":"清晰完整的候选记忆","tags":["标签"],"sourceQuote":"材料中的短原文"}]}。
最多 12 条；没有可靠信息时返回空数组。原始材料：\n${document.content.slice(0, 24000)}`;
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
  if (!response.ok) throw new Error(`DeepSeek 整理请求失败（${response.status}）。`);
  const payload = await response.json();
  const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
  return Array.isArray(parsed.memories) ? parsed.memories : [];
}

app.get('/api/health', (_, response) => response.json({ status: 'ok' }));
app.get('/api/memory', async (_, response, next) => {
  try { response.json(await loadStore()); } catch (error) { next(error); }
});
app.post('/api/memory/documents', async (request, response, next) => {
  try {
    const { title, sourceType, content } = request.body;
    if (!title || !content || !['chatgpt_export', 'note', 'conversation'].includes(sourceType)) {
      return response.status(400).json({ error: '导入材料不完整或来源类型无效。' });
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
    if (!document) return response.status(404).json({ error: '未找到原始材料。' });
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
    if (!['approved', 'rejected', 'pending'].includes(request.body.status)) return response.status(400).json({ error: '审核状态无效。' });
    const store = await loadStore();
    const memory = store.memories.find((item) => item.id === request.params.id);
    if (!memory) return response.status(404).json({ error: '未找到候选记忆。' });
    memory.status = request.body.status;
    await saveStore(store);
    response.json({ memory });
  } catch (error) { next(error); }
});
app.use((error, _, response, __) => {
  console.error(error);
  response.status(500).json({ error: error.message || '本地记忆服务发生未知错误。' });
});
app.listen(port, '127.0.0.1', () => console.log(`MindClone memory API listening on http://127.0.0.1:${port}`));
