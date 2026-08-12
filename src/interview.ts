import type { InterviewPacket, Message, Settings } from './types';

const keywords = [
  'Java', 'Kotlin', 'Android', 'iOS', 'Python', 'JavaScript', 'TypeScript', 'Go', 'Golang',
  '.NET', 'C#', 'Node', 'SQL', 'MySQL', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes',
  'microservices', 'distributed systems', 'customer support', 'customer success', 'operations', 'sales', 'recruiting', 'HR', 'remote', 'English',
];

function matchingKeywords(text: string) {
  const lowered = text.toLowerCase();
  return keywords.filter((keyword) => lowered.includes(keyword.toLowerCase())).slice(0, 8);
}

export function preparePacket(jd: string, resume: string): InterviewPacket {
  const jdKeywords = matchingKeywords(jd);
  const resumeKeywords = matchingKeywords(resume);
  const matching = jdKeywords.filter((item) => resumeKeywords.some((resumeItem) => resumeItem.toLowerCase() === item.toLowerCase()));
  const gaps = jdKeywords.filter((item) => !matching.includes(item));
  const focusAreas = [...matching, ...gaps].slice(0, 6);
  const questionTypes = ['Introduction and role fit', 'Project and experience deep dives', 'Technical or business judgment', 'Cross-functional collaboration', 'Motivation and remote collaboration'];

  return {
    id: crypto.randomUUID(),
    preparedAt: new Date().toISOString(),
    jd,
    resume,
    focusAreas,
    questionTypes,
    brief: matching.length
      ? `Prioritize experience related to ${matching.join(', ')}. For ${gaps.join(', ') || 'the role requirements'}, first explain transferable strengths and concrete learning or practice, then describe the problem-solving approach.`
      : 'No clear overlap was identified. Prioritize evidence from the submitted resume and map the role requirements to transferable strengths.',
  };
}

function systemPrompt(packet: InterviewPacket) {
  return `You are MindClone's interview-answer engine. Your response is a candidate answer to read and deliver aloud.

Rules:
1. Answer directly: lead with a clear conclusion, then give one or two concrete supporting points. Do not add greetings or say "as an AI."
2. Use only experience supported by this resume and the supplied interview context. When a question reaches beyond the material, explain transferable strengths plus a concrete learning or validation plan. Never invent metrics, companies, projects, tenure, or responsibilities.
3. For follow-up questions, challenges, or interruptions, treat what has already been said in this interview as binding context and remain consistent.
4. Write naturally for spoken delivery. Match the interviewer's language. Keep answers to roughly 90-170 English words unless the interviewer explicitly asks for more depth.
5. Interview preparation brief: ${packet.brief}

Target job description:
${packet.jd}

Submitted resume:
${packet.resume}`;
}

export async function streamCandidateAnswer(
  settings: Settings,
  packet: InterviewPacket,
  messages: Message[],
  onDelta: (delta: string) => void,
  signal: AbortSignal,
) {
  const requestMessages = [
    { role: 'system', content: systemPrompt(packet) },
    ...messages.map((message) => ({
      role: message.role === 'interviewer' ? 'user' : 'assistant',
      content: message.content,
    })),
  ];

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: settings.model,
      messages: requestMessages,
      temperature: 0.45,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`The local model did not respond (${response.status}). Check the model service and settings.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
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
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof delta === 'string') onDelta(delta);
      } catch {
        // Ignore provider keep-alives and partial event frames.
      }
    }
  }
}
