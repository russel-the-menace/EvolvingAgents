import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import { allowedAuthorization, assertOwnershipNonEscalation, assertTransition, defaultAuthorization } from './domain/cognition.mjs';
import { auditAnswer } from './domain/answer-audit.mjs';
import { compileSceneView, makeAnswerPlan } from './domain/scenes.mjs';
import { openDatabase } from './infrastructure/database.mjs';
import { extractDouyinShare, resolveDouyinLink, transcribeShortVideo } from './infrastructure/video-transcription.mjs';
import { createMindCloneLearningEngine } from './adapters/mindclone-learning.mjs';
import { applyInquiryReply, classifyInquiryReply, inquiryDialogueContext } from './domain/inquiry-dialogue.mjs';

const app = express();
const port = Number(process.env.PORT || 5270);
const repository = openDatabase(
  process.env.MINDCLONE_DB_PATH || join(process.cwd(), 'data', 'mindclone.sqlite'),
  process.env.MINDCLONE_LEGACY_STORE_PATH || join(process.cwd(), 'data', 'memory-store.json'),
);
const learningEngine = createMindCloneLearningEngine(repository);
app.use(express.json({ limit: '50mb' }));

function clip(value, length = 720) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > length ? `${text.slice(0, length)}...` : text;
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

async function relevantContext(query) {
  const ranked = await learningEngine.retrieve(query, { limit: 12 });
  const personal = ranked.filter(({ claim }) => claim.owner === 'user').map(({ claim }) => `- [${claim.id}] ${claim.kind}: ${clip(claim.proposition, 360)}`);
  const knowledge = ranked.filter(({ claim }) => claim.owner !== 'user').map(({ claim }) => `- [${claim.id}] ${claim.kind}: ${clip(claim.proposition, 360)}`);
  const sections = [];
  if (personal.length) sections.push(`User-owned authorized cognition:\n${personal.join('\n')}`);
  if (knowledge.length) sections.push(`External understood knowledge for reasoning only. Never claim its experiences as the user's:\n${knowledge.join('\n')}`);
  return sections.join('\n\n');
}

async function gatewayChat(messages, quality = 'Medium') {
  const base = (process.env.GATEWAY_BASE_URL || 'https://feiwan.online').replace(/\/$/, '');
  const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.GATEWAY_API_KEY || 'yeatom'}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'deepseek', quality, messages }), signal: AbortSignal.timeout(120_000) });
  const body = await response.json().catch(() => ({}));
  const content = body?.choices?.[0]?.message?.content;
  if (!response.ok || typeof content !== 'string') throw new Error(body.error?.message || body.error || `Gateway request failed (${response.status}).`);
  return content;
}

async function streamDailyChat(session, response, query, model, dialogueContext = '') {
  const context = await relevantContext(query);
  const system = `You are MindClone, a long-term conversational partner. Help the user think, challenge weak assumptions when warranted, and express conclusions naturally. Distinguish source knowledge from the user's position. An understood external claim is available for reasoning but is not the user's belief. Never turn external or third-party material into the user's experience. Match the user's language.\n\n${dialogueContext}\n\n${context || 'No authorized long-term context is relevant yet.'}`;
  const answer = await gatewayChat([{ role: 'system', content: system }, ...session.messages.slice(-24).map(({ role, content }) => ({ role, content }))], model === 'deepseek-high' ? 'High' : 'Medium');
  response.write(`data: ${JSON.stringify({ delta: answer })}\n\n`);
  return answer;
}

app.post('/api/model/chat', async (request, response, next) => { try { response.json({ content: await gatewayChat(request.body.messages, request.body.quality === 'High' ? 'High' : 'Medium') }); } catch (error) { next(error); } });

app.get('/api/health', (_, response) => response.json({ status: 'ok', store: 'sqlite', schema: 1 }));

app.get('/api/memory', (_, response) => {
  const claims = repository.listClaims();
  response.json({ documents: repository.listSources(), claims, memories: claims.map(mapClaimToLegacy), inquiries: repository.listInquiries() });
});

app.post('/api/memory/documents', async (request, response, next) => {
  try {
    const { title, sourceType, content, sourceUri, sourceActor } = request.body;
    if (!title || !content || !['chatgpt_export', 'note', 'conversation', 'short_video', 'resume', 'job_description', 'article', 'paper', 'podcast'].includes(sourceType)) {
      return response.status(400).json({ error: 'The imported material is incomplete or has an invalid source type.' });
    }
    const { source: document } = await learningEngine.ingest({
      id: randomUUID(), title: String(title).slice(0, 160), sourceType,
      content: String(content).slice(0, 2_000_000), sourceUri, sourceActor, createdAt: new Date().toISOString(),
    }, { deduplicate: false });
    const { claims } = await learningEngine.learn(document.id);
    response.status(201).json({ document: repository.getSource(document.id), claims });
  } catch (error) { next(error); }
});

app.post('/api/memory/extract', async (request, response, next) => {
  try {
    const source = repository.getSource(request.body.documentId);
    if (!source) return response.status(404).json({ error: 'Source material was not found.' });
    const { claims } = await learningEngine.learn(source.id);
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

app.post('/api/scenes/compile', async (request, response, next) => {
  try {
    const { jd, resume, audience = 'interviewer', goal = 'perform faithfully in the target interview', sceneType = 'interview' } = request.body;
    if (!jd?.trim() || !resume?.trim()) return response.status(400).json({ error: 'A job description and the submitted resume are required.' });
    const retrieved = await learningEngine.retrieve(`${sceneType} ${audience} ${goal} ${jd}`, { limit: 24 });
    const retrievedIds = new Set(retrieved.map((item) => item.claim.id));
    const claims = repository.listClaims().filter((claim) => retrievedIds.has(claim.id) || claim.kind === 'expression');
    const scene = compileSceneView({ sceneId: randomUUID(), sceneType, audience, goal, jd, resume, claims });
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
    const activeInquiry = repository.activeInquiryForSession(session.id);
    const inquiryReply = activeInquiry ? classifyInquiryReply(content) : null;
    repository.addMessage(session.id, { role: 'user', content });
    session = repository.getSession(session.id);
    if (session.messages.filter((message) => message.role === 'user').length === 1) repository.updateSession(session.id, { title: content.slice(0, 28) });
    response.setHeader('Content-Type', 'text/event-stream'); response.setHeader('Cache-Control', 'no-cache'); response.setHeader('Connection', 'keep-alive'); response.flushHeaders();
    let answer = await streamDailyChat(
      repository.getSession(session.id), response, content, request.body.model,
      activeInquiry ? inquiryDialogueContext(activeInquiry, inquiryReply) : '',
    );
    const { source } = await learningEngine.ingest({
      id: randomUUID(), title: `Daily chat: ${repository.getSession(session.id).title}`,
      sourceType: 'conversation', content: `User: ${content}\n\nMindClone: ${answer}`,
      sourceActor: 'user_and_mindclone', metadata: { directConversation: true }, createdAt: new Date().toISOString(),
    }, { deduplicate: false });
    if (activeInquiry) applyInquiryReply({ repository, inquiry: activeInquiry, reply: inquiryReply, evidenceSourceId: source.id });
    if (!activeInquiry) {
      const inquiry = repository.presentNextInquiry(session.id);
      if (inquiry) {
        const followUp = `\n\n顺便问你一个我在学习时留下的问题：${inquiry.question}`;
        answer += followUp;
        response.write(`data: ${JSON.stringify({ delta: followUp })}\n\n`);
      }
    }
    if (answer) repository.addMessage(session.id, { role: 'assistant', content: answer });
    response.write('data: [DONE]\n\n'); response.end();
    void learningEngine.learn(source.id, { context: { resolvedInquiryClaimId: activeInquiry?.claim_id } })
      .catch((error) => console.error('Daily claim extraction failed:', error.message));
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
