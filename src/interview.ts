import type { AnswerPlan, Claim, InterviewPacket, Message, Settings } from './types';

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
  const requestMessages = [
    { role: 'system', content: systemPrompt(packet, plan, claims) },
    ...messages.map((message) => ({ role: message.role === 'interviewer' ? 'user' : 'assistant', content: message.content })),
  ];
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: settings.model, messages: requestMessages, temperature: 0.35, stream: true }),
  });
  if (!response.ok || !response.body) throw new Error(`The local model did not respond (${response.status}). Check the model service and settings.`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    pending += decoder.decode(value, { stream: true }); const lines = pending.split('\n'); pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (data === '[DONE]') return;
      try { const delta = JSON.parse(data).choices?.[0]?.delta?.content; if (typeof delta === 'string') onDelta(delta); } catch { /* provider keep-alive */ }
    }
  }
}
