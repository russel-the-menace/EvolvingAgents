import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import { allowedAuthorization, assertOwnershipNonEscalation, assertTransition, defaultAuthorization } from './domain/cognition.mjs';
import { auditAnswer } from './domain/answer-audit.mjs';
import { compileSceneView, makeAnswerPlan, relevance, tokenize } from './domain/scenes.mjs';
import { openDatabase } from './infrastructure/database.mjs';
import { extractDouyinShare, resolveDouyinLink, transcribeShortVideo } from './infrastructure/video-transcription.mjs';

const app = express();
const port = Number(process.env.PORT || 5270);
const repository = openDatabase(
  process.env.MINDCLONE_DB_PATH || join(process.cwd(), 'data', 'mindclone.sqlite'),
  process.env.MINDCLONE_LEGACY_STORE_PATH || join(process.cwd(), 'data', 'memory-store.json'),
);
app.use(express.json({ limit: '50mb' }));

function clip(value, length = 720) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function sourceIsExternal(source) {
  return ['short_video', 'article', 'paper', 'podcast'].includes(source.sourceType);
}

function mapClaimToLegacy(claim) {
  const learning = claim.owner !== 'user';
  const kindMap = { knowledge: 'concept', example: 'case_example', expression: 'language_sample', value: 'viewpoint' };
  return {
    id: claim.id,
    documentId: '',
    kind: kindMap[claim.kind] || claim.kind,
    scope: learning ? 'learning' : 'personal',
    title: claim.title,
    content: claim.proposition,
    tags: claim.tags,
    sourceQuote: '',
    status: claim.epistemicStatus === 'endorsed' || claim.epistemicStatus === 'understood' ? 'approved' : claim.epistemicStatus === 'rejected' ? 'rejected' : 'pending',
    epistemicStatus: claim.epistemicStatus,
    authorizationScope: claim.authorizationScope,
    owner: claim.owner,
    createdAt: claim.createdAt,
  };
}

async function proposeWithDeepSeek(source) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured. Set it in the local .env file and restart the service.');
  const external = sourceIsExternal(source);
  const prompt = external
    ? `Extract atomic, reusable claims from external learning material. Never attribute the source author's experience or opinion to the user. Return strict JSON: {"claims":[{"kind":"knowledge|example","owner":"external|third_party","title":"short title","proposition":"clear reusable claim in the source language","tags":["tag"],"sourceQuote":"direct supporting quote","confidence":0.0}]}. Use owner=third_party for cases or speaker-specific viewpoints. Every item initially represents understanding, not user endorsement. Return at most 12 items. Source:\n${source.content.slice(0, 24000)}`
    : `Extract atomic claims from user-owned material. Use only supported information and distinguish experience, viewpoint, preference, value, knowledge, and expression samples. In conversation records, extract personal claims only from text explicitly labeled User; assistant text is context and must never become a user claim. Return strict JSON: {"claims":[{"kind":"experience|viewpoint|preference|value|knowledge|expression","owner":"user","title":"short title","proposition":"complete candidate claim","tags":["tag"],"sourceQuote":"direct supporting quote from the user","confidence":0.0}]}. These are observed candidates and require user endorsement before first-person use. Return at most 12 items. Source:\n${source.content.slice(0, 24000)}`;
  const response = await fetch(`${(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek extraction request failed (${response.status}).`);
  const payload = await response.json();
  const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
  return Array.isArray(parsed.claims) ? parsed.claims : [];
}

function persistProposals(source, proposals) {
  repository.deleteClaimsForSource(source.id);
  const claims = proposals.map((proposal, ordinal) => {
    const external = sourceIsExternal(source);
    const owner = external ? (proposal.owner === 'third_party' ? 'third_party' : 'external') : 'user';
    const kind = String(proposal.kind || (external ? 'knowledge' : 'experience'));
    const epistemicStatus = external ? 'understood' : 'observed';
    const evidenceId = repository.addEvidence({
      sourceId: source.id,
      ordinal,
      text: String(proposal.sourceQuote || proposal.proposition || '').slice(0, 1200),
      speaker: external ? 'source_author' : 'user',
      owner,
    });
    return repository.addClaim({
      title: String(proposal.title || 'Untitled claim').slice(0, 120),
      proposition: String(proposal.proposition || '').slice(0, 1600),
      kind,
      owner,
      epistemicStatus,
      authorizationScope: defaultAuthorization({ owner, kind, status: epistemicStatus }),
      tags: Array.isArray(proposal.tags) ? proposal.tags.map(String).slice(0, 12) : [],
      confidence: Math.max(0, Math.min(Number(proposal.confidence || 0.6), 1)),
    }, evidenceId);
  }).filter((claim) => claim.proposition);
  if (sourceIsExternal(source)) {
    for (const claim of claims.filter((item) => item.kind === 'knowledge').slice(0, 3)) {
      repository.addInquiry({
        claimId: claim.id,
        question: `你怎么看“${clip(claim.proposition, 120)}”？这只是你理解的新知识，还是也代表你的判断？`,
        reason: 'External knowledge requires user deliberation before it can represent a personal viewpoint.',
        priority: 0.5 + claim.confidence * 0.3,
      });
    }
  }
  return claims;
}

function relevantContext(query) {
  const queryTokens = tokenize(query);
  const ranked = repository.listClaims()
    .filter((claim) => claim.authorizationScope !== 'none' && !['rejected', 'superseded', 'contested'].includes(claim.epistemicStatus))
    .map((claim) => ({ claim, score: relevance(queryTokens, claim) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);
  const personal = ranked.filter(({ claim }) => claim.owner === 'user').map(({ claim }) => `- [${claim.id}] ${claim.kind}: ${clip(claim.proposition, 360)}`);
  const knowledge = ranked.filter(({ claim }) => claim.owner !== 'user').map(({ claim }) => `- [${claim.id}] ${claim.kind}: ${clip(claim.proposition, 360)}`);
  const inquiries = repository.listInquiries().slice(0, 2).map((item) => `- ${item.question}`);
  const sections = [];
  if (personal.length) sections.push(`User-owned authorized cognition:\n${personal.join('\n')}`);
  if (knowledge.length) sections.push(`External understood knowledge for reasoning only. Never claim its experiences as the user's:\n${knowledge.join('\n')}`);
  if (inquiries.length) sections.push(`Deferred discussion candidates. Address the user's request first; then ask at most one if natural:\n${inquiries.join('\n')}`);
  return sections.join('\n\n');
}

async function streamDailyChat(session, response, query, model) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured. Set it in the local .env file and restart the service.');
  const context = relevantContext(query);
  const system = `You are MindClone, a long-term conversational partner. Help the user think, challenge weak assumptions when warranted, and express conclusions naturally. Distinguish source knowledge from the user's position. An understood external claim is available for reasoning but is not the user's belief. Never turn external or third-party material into the user's experience. Match the user's language.\n\n${context || 'No authorized long-term context is relevant yet.'}`;
  const options = {
    'deepseek-light': { model: 'deepseek-v4-flash', thinking: false },
    'deepseek-medium': { model: 'deepseek-v4-flash', thinking: true },
    'deepseek-high': { model: 'deepseek-v4-pro', thinking: false },
    'deepseek-ultra': { model: 'deepseek-v4-pro', thinking: true },
  };
  const selected = options[model] || options['deepseek-light'];
  const upstream = await fetch(`${(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: selected.model, stream: true, thinking: { type: selected.thinking ? 'enabled' : 'disabled' }, ...(selected.thinking ? { reasoning_effort: 'high' } : { temperature: 0.7 }), messages: [{ role: 'system', content: system }, ...session.messages.slice(-24).map(({ role, content }) => ({ role, content }))] }),
  });
  if (!upstream.ok || !upstream.body) throw new Error(`DeepSeek daily chat request failed (${upstream.status}).`);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let answer = ''; let pending = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n'); pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (data === '[DONE]') continue;
      try { const delta = JSON.parse(data).choices?.[0]?.delta?.content; if (typeof delta === 'string') { answer += delta; response.write(`data: ${JSON.stringify({ delta })}\n\n`); } } catch { /* provider keep-alive */ }
    }
  }
  return answer;
}

app.get('/api/health', (_, response) => response.json({ status: 'ok', store: 'sqlite', schema: 1 }));

app.get('/api/memory', (_, response) => {
  const claims = repository.listClaims();
  response.json({ documents: repository.listSources(), claims, memories: claims.map(mapClaimToLegacy), inquiries: repository.listInquiries() });
});

app.post('/api/memory/documents', (request, response, next) => {
  try {
    const { title, sourceType, content, sourceUri, sourceActor } = request.body;
    if (!title || !content || !['chatgpt_export', 'note', 'conversation', 'short_video', 'resume', 'job_description', 'article', 'paper', 'podcast'].includes(sourceType)) {
      return response.status(400).json({ error: 'The imported material is incomplete or has an invalid source type.' });
    }
    const document = repository.addSource({ id: randomUUID(), title: String(title).slice(0, 160), sourceType, content: String(content).slice(0, 2_000_000), sourceUri, sourceActor, createdAt: new Date().toISOString() });
    response.status(201).json({ document });
  } catch (error) { next(error); }
});

app.post('/api/memory/extract', async (request, response, next) => {
  try {
    const source = repository.getSource(request.body.documentId);
    if (!source) return response.status(404).json({ error: 'Source material was not found.' });
    const claims = persistProposals(source, await proposeWithDeepSeek(source));
    repository.markSourceExtracted(source.id);
    response.json({ claims, memories: claims.map(mapClaimToLegacy) });
  } catch (error) { next(error); }
});

app.post('/api/claims/:id/transition', (request, response, next) => {
  try {
    const claim = repository.getClaim(request.params.id);
    if (!claim) return response.status(404).json({ error: 'Claim was not found.' });
    const toStatus = request.body.status;
    const requestedScope = request.body.authorizationScope || defaultAuthorization({ owner: claim.owner, kind: claim.kind, status: toStatus });
    assertTransition(claim.epistemicStatus, toStatus);
    assertOwnershipNonEscalation(claim, requestedScope);
    if (!allowedAuthorization({ owner: claim.owner, kind: claim.kind, status: toStatus, requestedScope })) {
      return response.status(400).json({ error: `Authorization ${requestedScope} is not valid for this claim.` });
    }
    const updated = repository.updateClaim(claim.id, { epistemicStatus: toStatus, authorizationScope: requestedScope, supersededBy: request.body.supersededBy });
    repository.addAuthorizationEvent({ claimId: claim.id, fromStatus: claim.epistemicStatus, toStatus, fromScope: claim.authorizationScope, toScope: requestedScope, reason: String(request.body.reason || 'User review').slice(0, 500) });
    response.json({ claim: updated, memory: mapClaimToLegacy(updated) });
  } catch (error) { next(error); }
});

app.post('/api/claims/:id/internalize', (request, response, next) => {
  try {
    const sourceClaim = repository.getClaim(request.params.id);
    if (!sourceClaim) return response.status(404).json({ error: 'Source claim was not found.' });
    if (!['external', 'third_party'].includes(sourceClaim.owner) || sourceClaim.epistemicStatus !== 'understood') {
      return response.status(400).json({ error: 'Only understood external knowledge can be internalized through this operation.' });
    }
    const proposition = String(request.body.proposition || sourceClaim.proposition).trim();
    const reason = String(request.body.reason || '').trim();
    if (!reason) return response.status(400).json({ error: 'A user discussion or endorsement reason is required.' });
    const derived = repository.addClaim({
      title: String(request.body.title || `My view: ${sourceClaim.title}`).slice(0, 120),
      proposition: proposition.slice(0, 1600),
      kind: 'viewpoint',
      owner: 'user',
      epistemicStatus: 'endorsed',
      authorizationScope: 'personal_view',
      tags: sourceClaim.tags,
      contextScope: Array.isArray(request.body.contextScope) ? request.body.contextScope : [],
      confidence: Math.max(0.5, sourceClaim.confidence),
    });
    repository.addClaimRelation(sourceClaim.id, derived.id, 'internalized_as');
    repository.addAuthorizationEvent({
      claimId: derived.id,
      fromStatus: 'observed',
      toStatus: 'endorsed',
      fromScope: 'none',
      toScope: 'personal_view',
      reason,
    });
    response.status(201).json({ sourceClaim, claim: derived });
  } catch (error) { next(error); }
});

app.patch('/api/memory/candidates/:id', (request, response, next) => {
  try {
    const claim = repository.getClaim(request.params.id);
    if (!claim) return response.status(404).json({ error: 'Candidate claim was not found.' });
    const legacyToStatus = { approved: 'endorsed', rejected: 'rejected', pending: 'contested' };
    const toStatus = legacyToStatus[request.body.status];
    if (!toStatus) return response.status(400).json({ error: 'Invalid review status.' });
    assertTransition(claim.epistemicStatus, toStatus);
    const scope = defaultAuthorization({ owner: claim.owner, kind: claim.kind, status: toStatus });
    const updated = repository.updateClaim(claim.id, { epistemicStatus: toStatus, authorizationScope: scope });
    repository.addAuthorizationEvent({ claimId: claim.id, fromStatus: claim.epistemicStatus, toStatus, fromScope: claim.authorizationScope, toScope: scope, reason: 'Legacy review interface' });
    response.json({ memory: mapClaimToLegacy(updated), claim: updated });
  } catch (error) { next(error); }
});

app.post('/api/scenes/compile', (request, response, next) => {
  try {
    const { jd, resume, audience = 'interviewer', goal = 'perform faithfully in the target interview', sceneType = 'interview' } = request.body;
    if (!jd?.trim() || !resume?.trim()) return response.status(400).json({ error: 'A job description and the submitted resume are required.' });
    const scene = compileSceneView({ sceneId: randomUUID(), sceneType, audience, goal, jd, resume, claims: repository.listClaims() });
    repository.addScene(scene);
    response.status(201).json({ scene });
  } catch (error) { next(error); }
});

app.post('/api/scenes/:id/plan', (request, response, next) => {
  try {
    const scene = repository.getScene(request.params.id);
    if (!scene) return response.status(404).json({ error: 'Scene snapshot was not found.' });
    const plan = makeAnswerPlan({ question: String(request.body.question || ''), scene });
    const claims = repository.listClaims();
    const selected = claims.filter((claim) => [...plan.knowledgeClaimIds, ...plan.personalClaimIds].includes(claim.id));
    response.json({ plan, scene, claims: selected });
  } catch (error) { next(error); }
});

app.post('/api/scenes/:id/complete', (request, response, next) => {
  try {
    const scene = repository.getScene(request.params.id);
    if (!scene) return response.status(404).json({ error: 'Scene snapshot was not found.' });
    const { question, plan, answer } = request.body;
    const audit = auditAnswer({ answer, scene, plan, claims: repository.listClaims() });
    const runId = repository.addAnswerRun({ sceneId: scene.id, question, plan, answer, audit });
    response.json({ runId, audit });
  } catch (error) { next(error); }
});

app.post('/api/memory/short-videos/prepare', async (request, response, next) => {
  try {
    const parsed = extractDouyinShare(request.body.shareText);
    let sourceUrl = parsed.sourceUrl;
    try { sourceUrl = await resolveDouyinLink(sourceUrl); } catch (error) { console.warn('Douyin link resolution skipped:', error.message); }
    response.json({ title: parsed.title, sourceUrl, content: ['Source platform: Douyin', `Source link: ${sourceUrl}`, `Original share text: ${parsed.shareText}`, parsed.tags.length ? `Topics: ${parsed.tags.join(', ')}` : '', '', 'Voice transcript:', 'Add or correct the spoken transcript here before saving.'].filter(Boolean).join('\n') });
  } catch (error) { next(error); }
});

app.post('/api/memory/short-videos/transcribe', async (request, response, next) => {
  try {
    const parsed = extractDouyinShare(request.body.shareText);
    const { transcript } = await transcribeShortVideo(parsed.shareText);
    response.json({ title: parsed.title, sourceUrl: parsed.sourceUrl, content: ['Source platform: Douyin', `Source link: ${parsed.sourceUrl}`, `Original share text: ${parsed.shareText}`, parsed.tags.length ? `Topics: ${parsed.tags.join(', ')}` : '', '', 'Voice transcript:', transcript].filter(Boolean).join('\n') });
  } catch (error) { next(error); }
});

app.get('/api/chat/sessions', (_, response) => response.json({ sessions: repository.listSessions() }));
app.post('/api/chat/sessions', (_, response) => response.status(201).json({ session: repository.createSession() }));
app.patch('/api/chat/sessions/:id', (request, response) => {
  const session = repository.updateSession(request.params.id, request.body);
  if (!session) return response.status(404).json({ error: 'Conversation was not found.' });
  response.json({ session });
});

app.post('/api/chat/sessions/:id/stream', async (request, response, next) => {
  try {
    const content = String(request.body.content || '').trim();
    if (!content) return response.status(400).json({ error: 'A message is required.' });
    let session = repository.getSession(request.params.id);
    if (!session) return response.status(404).json({ error: 'Conversation was not found.' });
    if (request.body.replaceFromMessageId && !repository.truncateSession(session.id, request.body.replaceFromMessageId)) return response.status(404).json({ error: 'The message to edit was not found.' });
    repository.addMessage(session.id, { role: 'user', content });
    session = repository.getSession(session.id);
    if (session.messages.filter((message) => message.role === 'user').length === 1) repository.updateSession(session.id, { title: content.slice(0, 28) });
    response.setHeader('Content-Type', 'text/event-stream'); response.setHeader('Cache-Control', 'no-cache'); response.setHeader('Connection', 'keep-alive'); response.flushHeaders();
    const answer = await streamDailyChat(repository.getSession(session.id), response, content, request.body.model);
    if (answer) repository.addMessage(session.id, { role: 'assistant', content: answer });
    const source = repository.addSource({ id: randomUUID(), title: `Daily chat: ${repository.getSession(session.id).title}`, sourceType: 'conversation', content: `User: ${content}\n\nMindClone: ${answer}`, sourceActor: 'user_and_mindclone', createdAt: new Date().toISOString() });
    response.write('data: [DONE]\n\n'); response.end();
    void proposeWithDeepSeek(source).then((proposals) => { persistProposals(source, proposals); repository.markSourceExtracted(source.id); }).catch((error) => console.error('Daily claim extraction failed:', error.message));
  } catch (error) { next(error); }
});

app.delete('/api/chat/sessions/:id', (request, response) => { repository.deleteSession(request.params.id); response.status(204).end(); });

app.use((error, _, response, __) => {
  console.error(error);
  response.status(500).json({ error: error.message || 'The local cognition service encountered an unknown error.' });
});

if (process.env.MINDCLONE_NO_LISTEN !== '1') {
  app.listen(port, '127.0.0.1', () => console.log(`MindClone cognition API listening on http://127.0.0.1:${port}`));
}

export { app, repository };
