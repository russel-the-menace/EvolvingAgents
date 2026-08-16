import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { allowedAuthorization, assertOwnershipNonEscalation, assertTransition, defaultAuthorization } from './domain/cognition.mjs';
import { auditAnswer } from './domain/answer-audit.mjs';
import { compileSceneView, makeAnswerPlan } from './domain/scenes.mjs';
import { openDatabase } from './infrastructure/database.mjs';
import { extractDouyinShare, resolveDouyinLink, transcribeShortVideo } from './infrastructure/video-transcription.mjs';
import { createMindCloneLearningEngine } from './adapters/mindclone-learning.mjs';
import { applyInquiryReply, classifyInquiryReply, inquiryDialogueContext } from './domain/inquiry-dialogue.mjs';
import { compileTranscript, contextAuditText } from './domain/context-compiler.mjs';
import { refreshConversationSummary, refreshSceneSummary } from './domain/context-summarization.mjs';
import { createModelGateway, createOllamaGateway, createOpenAICompatibleGateway } from '@evolving-agents/model-gateway';
import { createChatRuntime } from '@evolving-agents/chat-runtime';

const app = express();
const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 5270);
const repository = openDatabase(
  process.env.MINDCLONE_DB_PATH || join(process.cwd(), 'data', 'mindclone.sqlite'),
  process.env.MINDCLONE_LEGACY_STORE_PATH || join(process.cwd(), 'data', 'memory-store.json'),
);
const gateway = createModelGateway({ baseUrl: process.env.GATEWAY_BASE_URL || 'https://feiwan.online', apiKey: process.env.GATEWAY_API_KEY || 'yeatom' });
const localModel = process.env.LOCAL_MODEL_BASE_URL && process.env.LOCAL_MODEL_NAME
  ? (process.env.LOCAL_MODEL_PROVIDER === 'ollama'
    ? createOllamaGateway({ baseUrl: process.env.LOCAL_MODEL_BASE_URL, model: process.env.LOCAL_MODEL_NAME,
      contextTokens: Number(process.env.LOCAL_MODEL_CONTEXT_TOKENS || 8192),
      maxOutputTokens: Number(process.env.LOCAL_MODEL_MAX_OUTPUT_TOKENS || 768) })
    : createOpenAICompatibleGateway({ baseUrl: process.env.LOCAL_MODEL_BASE_URL, model: process.env.LOCAL_MODEL_NAME, apiKey: process.env.LOCAL_MODEL_API_KEY || 'local' }))
  : null;
const chatRuntime = createChatRuntime(repository, { titleLength: 28 });
const learningEngine = createMindCloneLearningEngine(repository, gateway);
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

async function extractMaterial(input, label) {
  if (!input || typeof input !== 'object') throw new Error(`A ${label} is required.`);
  if (typeof input.text === 'string' && input.text.trim()) return input.text.trim();
  if (typeof input.data !== 'string' || !input.data) throw new Error(`The ${label} file is empty.`);
  const encoded = input.data.includes(',') ? input.data.slice(input.data.indexOf(',') + 1) : input.data;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error(`The ${label} file is empty or too large.`);
  const mime = String(input.mime || 'application/octet-stream').toLowerCase();
  const dir = await mkdtemp(join(tmpdir(), 'mindclone-interview-'));
  const path = join(dir, String(input.name || `${label}.bin`).replace(/[^a-z0-9._-]/gi, '_'));
  try {
    await writeFile(path, bytes);
    if (mime === 'application/pdf' || path.toLowerCase().endsWith('.pdf')) {
      return (await execFileAsync('pdftotext', ['-layout', path, '-'], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
    }
    if (mime.startsWith('image/')) {
      return (await execFileAsync('tesseract', [path, 'stdout', '-l', process.env.OCR_LANG || 'eng+chi_sim'], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
    }
    return bytes.toString('utf8').trim();
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function normalizeMaterial(text, label) {
  if (!localModel || text.length < 20) return text;
  const result = await localModel.complete([{ role: 'system', content: `Extract the readable ${label} content faithfully. Preserve names, dates, employers, skills and requirements. Return plain text only; do not invent or summarize.` }, { role: 'user', content: text.slice(0, 120000) }]);
  return result.trim() || text;
}

async function relevantContext(query) {
  const ranked = await learningEngine.retrieveEvidence(query, { limit: 12, paddingChars: 400 });
  const evidenceText = (evidence) => evidence?.map((item) => item.originalContext?.text || item.text).join(' | ');
  const personal = ranked.filter(({ claim }) => claim.owner === 'user').map(({ claim, evidence }) => `- [${claim.id}] ${claim.kind}: ${clip(claim.proposition, 360)}\n  Source evidence: ${clip(evidenceText(evidence), 600)}`);
  const knowledge = ranked.filter(({ claim }) => claim.owner !== 'user').map(({ claim, evidence }) => `- [${claim.id}] ${claim.kind}: ${clip(claim.proposition, 360)}\n  Source evidence: ${clip(evidenceText(evidence), 600)}`);
  const sections = [];
  if (personal.length) sections.push(`User-owned authorized cognition:\n${personal.join('\n')}`);
  if (knowledge.length) sections.push(`External understood knowledge for reasoning only. Never claim its experiences as the user's:\n${knowledge.join('\n')}`);
  return { text: sections.join('\n\n'), ranked };
}

async function streamDailyChat(session, response, query, model, dialogueContext = '') {
  const context = await relevantContext(query);
  const summary = repository.getActiveContextSummary(session.id);
  const transcript = compileTranscript(session.messages, { budgetChars: 24_000, recentCount: 8, summary });
  repository.addContextRun({
    sessionId: session.id, question: query, ...transcript,
    items: [
      ...transcript.messages.map((message) => ({ type: 'message', id: message.id, content: message.content, selectionReason: 'transcript_budget' })),
      ...(transcript.summary ? [{ type: 'summary', id: transcript.summary.id, content: transcript.summary.content, selectionReason: 'covers_omitted_history' }] : []),
      ...context.ranked.flatMap(({ claim, evidence }) => [
        { type: 'claim', id: claim.id, content: claim.proposition, selectionReason: 'query_retrieval' },
        ...(evidence || []).map((item) => ({ type: 'evidence', id: item.id, sourceId: item.source?.id, evidenceId: item.id, content: item.text, selectionReason: 'supports_claim' })),
      ]),
    ],
  });
  const system = `You are MindClone, a long-term conversational partner. Help the user think, challenge weak assumptions when warranted, and express conclusions naturally. Distinguish source knowledge from the user's position. An understood external claim is available for reasoning but is not the user's belief. Never turn external or third-party material into the user's experience. Match the user's language.\n\n${contextAuditText(transcript)}\n${transcript.summary ? `Older conversation summary with original message IDs:\n${transcript.summary.content}\n` : ''}${dialogueContext}\n\n${context.text || 'No authorized long-term context is relevant yet.'}`;
  return gateway.stream([{ role: 'system', content: system }, ...transcript.messages.map(({ role, content }) => ({ role, content }))], {
    quality: model === 'deepseek-high' ? 'High' : 'Medium',
    onDelta: (delta) => response.write(`data: ${JSON.stringify({ delta })}\n\n`),
  });
}

app.post('/api/model/chat', async (request, response, next) => {
  try {
    if (!localModel) return response.status(503).json({ error: 'Local formal model is not configured. Set LOCAL_MODEL_BASE_URL and LOCAL_MODEL_NAME.' });
    response.json({ content: await localModel.complete(request.body.messages) });
  } catch (error) { next(error); }
});

app.get('/api/health', (_, response) => response.json({ status: 'ok', store: 'sqlite', schema: 1 }));

app.get('/api/memory', (_, response) => {
  const claims = repository.listClaims();
  response.json({ documents: repository.listSources(), claims, memories: claims.map(mapClaimToLegacy), inquiries: repository.listInquiries() });
});

app.get('/api/context-runs/:id', (request, response) => {
  const run = repository.getContextRun(request.params.id);
  if (!run) return response.status(404).json({ error: 'Context run was not found.' });
  response.json({ run });
});

app.get('/api/chat/sessions/:id/context-runs', (request, response) => response.json({
  runIds: repository.listContextRuns(request.params.id),
}));

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
    const { audience = 'interviewer', goal = 'perform faithfully in the target interview', sceneType = 'interview' } = request.body;
    const jd = await normalizeMaterial(await extractMaterial(request.body.jdInput || { text: request.body.jd }, 'job description'), 'job description');
    const resume = await normalizeMaterial(await extractMaterial(request.body.resumeInput || { text: request.body.resume }, 'resume'), 'resume');
    if (!jd.trim() || !resume.trim()) return response.status(400).json({ error: 'The job description and resume must contain readable text.' });
    const retrieved = await learningEngine.retrieve(`${sceneType} ${audience} ${goal} ${jd}`, { limit: 24 });
    const retrievedIds = new Set(retrieved.map((item) => item.claim.id));
    const claims = repository.listClaims().filter((claim) => retrievedIds.has(claim.id) || claim.kind === 'expression');
    const scene = compileSceneView({ sceneId: randomUUID(), sceneType, audience, goal, jd, resume, claims });
    repository.addScene(scene);
    response.status(201).json({ scene });
  } catch (error) { next(error); }
});

app.get('/api/scenes', (_, response) => response.json({ interviews: repository.listScenes() }));
app.get('/api/scenes/:id', (request, response, next) => {
  try {
    const scene = repository.getScene(request.params.id);
    if (!scene) return response.status(404).json({ error: 'Interview was not found.' });
    response.json({ scene, runs: repository.listAnswerRuns(scene.id).map((run) => ({ question: run.question, answer: run.answer || '' })) });
  } catch (error) { next(error); }
});

app.post('/api/scenes/:id/plan', (request, response, next) => {
  try {
    const scene = repository.getScene(request.params.id);
    if (!scene) return response.status(404).json({ error: 'Scene snapshot was not found.' });
    const question = String(request.body.question || '');
    const basePlan = makeAnswerPlan({ question, scene });
    const claims = repository.listClaims();
    const selected = claims.filter((claim) => [...basePlan.knowledgeClaimIds, ...basePlan.personalClaimIds].includes(claim.id));
    const priorMessages = repository.listAnswerRuns(scene.id).flatMap((run) => [
      { id: `${run.id}:question`, role: 'user', content: run.question, createdAt: run.createdAt },
      { id: `${run.id}:answer`, role: 'assistant', content: run.answer || '', createdAt: run.createdAt },
    ]);
    const transcript = compileTranscript([...priorMessages, { id: randomUUID(), role: 'user', content: question }], {
      budgetChars: 16_000, recentCount: 6, summary: repository.getActiveSceneSummary(scene.id),
    });
    const contextRunId = repository.addContextRun({ sceneId: scene.id, question, ...transcript, items: [
      { type: 'scene_fact', id: `${scene.id}:jd`, content: scene.jd, selectionReason: 'active_scene' },
      { type: 'scene_fact', id: `${scene.id}:resume`, content: scene.resume, selectionReason: 'active_scene' },
      ...(transcript.summary ? [{ type: 'summary', id: transcript.summary.id, content: transcript.summary.content, selectionReason: 'covers_omitted_formal_history' }] : []),
      ...transcript.messages.map((message) => ({ type: 'formal_message', id: message.id, content: message.content, selectionReason: 'formal_transcript_budget' })),
      ...selected.flatMap((claim) => [{ type: 'claim', id: claim.id, content: claim.proposition, selectionReason: 'answer_plan' },
        ...repository.evidenceForClaim(claim.id).map((item) => ({ type: 'evidence', id: item.id, evidenceId: item.id, sourceId: item.source?.id, content: item.text, selectionReason: 'supports_answer_claim' }))]),
    ] });
    const plan = { ...basePlan, contextRunId };
    response.json({ plan, scene, claims: selected, transcriptMessages: transcript.messages.map(({ role, content }) => ({ role, content })) });
  } catch (error) { next(error); }
});

app.post('/api/scenes/:id/complete', (request, response, next) => {
  try {
    const scene = repository.getScene(request.params.id);
    if (!scene) return response.status(404).json({ error: 'Scene snapshot was not found.' });
    const { question, plan, answer } = request.body;
    const audit = auditAnswer({ answer, scene, plan, claims: repository.listClaims() });
    const runId = repository.addAnswerRun({ sceneId: scene.id, contextRunId: plan.contextRunId, question, plan, answer, audit });
    if (localModel) void refreshSceneSummary({ repository, gateway: localModel, sceneId: scene.id })
      .catch((error) => console.error('Scene summary refresh failed:', error.message));
    response.json({ runId, audit });
  } catch (error) { next(error); }
});

app.get('/api/scenes/:id/transcript', (request, response) => response.json({
  runs: repository.listAnswerRuns(request.params.id), summary: repository.getActiveSceneSummary(request.params.id),
}));

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
    const result = await chatRuntime.run({
      sessionId: request.params.id,
      content: request.body.content,
      replaceFromMessageId: request.body.replaceFromMessageId,
      beforeMessage: ({ session, content }) => {
        const activeInquiry = repository.activeInquiryForSession(session.id);
        return { activeInquiry, inquiryReply: activeInquiry ? classifyInquiryReply(content) : null };
      },
      createAnswer: ({ session, content, context }) => {
        response.setHeader('Content-Type', 'text/event-stream'); response.setHeader('Cache-Control', 'no-cache'); response.setHeader('Connection', 'keep-alive'); response.flushHeaders();
        return streamDailyChat(session, response, content, request.body.model, context.activeInquiry ? inquiryDialogueContext(context.activeInquiry, context.inquiryReply) : '');
      },
      afterAnswer: async ({ content: initialAnswer, session, context }) => {
        let answer = initialAnswer;
        const userMessage = [...session.messages].reverse().find((message) => message.role === 'user');
        const { source } = await learningEngine.ingest({ id: randomUUID(), title: `Daily chat: ${session.title}`, sourceType: 'conversation', content: `User: ${String(request.body.content).trim()}\n\nMindClone: ${answer}`, sourceActor: 'user_and_mindclone', metadata: { directConversation: true, sessionId: session.id, userMessageId: userMessage?.id }, createdAt: new Date().toISOString() }, { deduplicate: false });
        if (context.activeInquiry) applyInquiryReply({ repository, inquiry: context.activeInquiry, reply: context.inquiryReply, evidenceSourceId: source.id });
        if (!context.activeInquiry) {
          const inquiry = repository.presentNextInquiry(session.id);
          if (inquiry) { const followUp = `\n\n顺便问你一个我在学习时留下的问题：${inquiry.question}`; answer += followUp; response.write(`data: ${JSON.stringify({ delta: followUp })}\n\n`); }
        }
        void learningEngine.learn(source.id, { context: { resolvedInquiryClaimId: context.activeInquiry?.claim_id } }).catch((error) => console.error('Daily claim extraction failed:', error.message));
        void refreshConversationSummary({ repository, gateway, sessionId: session.id }).catch((error) => console.error('Conversation summary refresh failed:', error.message));
        return answer;
      },
    });
    response.write('data: [DONE]\n\n'); response.end();
    return result;
  } catch (error) {
    if (!response.headersSent) return next(error);
    response.write(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Chat request failed.' })}\n\n`);
    response.write('data: [DONE]\n\n'); response.end();
  }
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
