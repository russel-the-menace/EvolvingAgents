import type { AnswerPlan, Claim, InterviewPacket, Message, Settings } from './types';
import { compileFormalTranscript } from './context';

function claimLines(ids: string[], claims: Claim[]) {
  const allowed = new Set(ids);
  return claims.filter((claim) => allowed.has(claim.id)).map((claim) => `- [${claim.id}] ${claim.proposition}`).join('\n') || '- None selected';
}

function systemPrompt(packet: InterviewPacket, plan: AnswerPlan, claims: Claim[]) {
  return `You are MindClone's scene-conditioned answer renderer. Produce a candidate answer the user can deliver aloud.

The answer plan has already selected authorized cognition. Do not introduce a new first-person experience outside the submitted resume or PERSONAL AUTHORIZED CLAIMS.

Rules:
1. Lead with a clear conclusion, then support it with relevant industry reasoning and authorized evidence.
2. The submitted resume is authoritative only inside this frozen interview scene. Never modify the longitudinal identity.
3. External understood knowledge may improve reasoning, but its author, cases, and experiences are not the user's.
4. Never invent employers, projects, dates, metrics, responsibilities, tenure, or achievements.
5. If evidence is insufficient, state a transferable approach or learning plan instead of fabricating experience.
6. Remain consistent with prior answers and match the interviewer's language.
7. Sound like a clear, professional version of the user, not generic assistant prose.

ANSWER PLAN:
${plan.thesisInstruction}

AUTHORIZED KNOWLEDGE:
${claimLines(plan.knowledgeClaimIds, claims)}

PERSONAL AUTHORIZED CLAIMS:
${claimLines(plan.personalClaimIds, claims)}

SCENE GOAL:
${packet.brief}

TARGET JOB DESCRIPTION:
${packet.jd}

SCENE-AUTHORIZED SUBMITTED RESUME:
${packet.resume}`;
}

export async function streamCandidateAnswer(
  settings: Settings,
  packet: InterviewPacket,
  plan: AnswerPlan,
  claims: Claim[],
  messages: Message[],
  onDelta: (delta: string) => void,
  signal: AbortSignal,
) {
  const transcript = compileFormalTranscript(messages);
  const requestMessages = [
    { role: 'system', content: systemPrompt(packet, plan, claims) },
    { role: 'system', content: `Transcript context: ${transcript.messages.length}/${transcript.totalMessages} messages, ${transcript.usedChars}/${transcript.budgetChars} chars. Older messages remain in the formal transcript but were omitted from this working prompt and must not be invented.` },
    ...transcript.messages.map((message) => ({ role: message.role === 'interviewer' ? 'user' : 'assistant', content: message.content })),
  ];
  const response = await fetch('/api/model/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ quality: 'High', messages: requestMessages }),
  });
  const body = await response.json();
  if (!response.ok || typeof body.content !== 'string') throw new Error(body.error || `Gateway did not respond (${response.status}).`);
  onDelta(body.content);
}
