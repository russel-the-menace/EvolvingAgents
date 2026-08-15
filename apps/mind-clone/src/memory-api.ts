import type { AnswerPlan, Claim, DailyModel, DailySession, InterviewPacket, MemoryDocument } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Local memory service error (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const memoryApi = {
  importDocument: async (payload: Pick<MemoryDocument, 'title' | 'sourceType' | 'content'>) => {
    const result = await request<{ document: MemoryDocument; claims: Claim[] }>('/memory/documents', {
      method: 'POST', body: JSON.stringify(payload),
    });
    if (!result.document || !Array.isArray(result.claims)) {
      throw new Error('The memory service returned an incompatible learning response. Restart the local API and try again.');
    }
    return result;
  },
  prepareShortVideo: (shareText: string) =>
    request<{ title: string; content: string; sourceUrl: string }>('/memory/short-videos/prepare', { method: 'POST', body: JSON.stringify({ shareText }) }),
  transcribeShortVideo: (shareText: string) =>
    request<{ title: string; content: string; sourceUrl: string }>('/memory/short-videos/transcribe', { method: 'POST', body: JSON.stringify({ shareText }) }),
  compileScene: (payload: { jd: string; resume: string; audience?: string; goal?: string; sceneType?: string }) =>
    request<{ scene: Omit<InterviewPacket, 'preparedAt' | 'focusAreas' | 'questionTypes' | 'brief' | 'sceneId'> & { id: string; writeBack: false; knowledgeClaims: Claim[]; personalClaims: Claim[]; expressionClaims: Claim[] } }>('/scenes/compile', { method: 'POST', body: JSON.stringify(payload) }),
  planAnswer: (sceneId: string, question: string) =>
    request<{ plan: AnswerPlan; claims: Claim[] }>(`/scenes/${sceneId}/plan`, { method: 'POST', body: JSON.stringify({ question }) }),
  completeAnswer: (sceneId: string, payload: { question: string; plan: AnswerPlan; answer: string }) =>
    request<{ runId: string; audit: { passed: boolean; violations: Array<{ type: string }> } }>(`/scenes/${sceneId}/complete`, { method: 'POST', body: JSON.stringify(payload) }),
  listSessions: () => request<{ sessions: DailySession[] }>('/chat/sessions'),
  createSession: () => request<{ session: DailySession }>('/chat/sessions', { method: 'POST' }),
  updateSession: (sessionId: string, payload: Partial<Pick<DailySession, 'title' | 'pinned'>>) =>
    request<{ session: DailySession }>(`/chat/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSession: (sessionId: string) => request<void>(`/chat/sessions/${sessionId}`, { method: 'DELETE' }),
  streamChat: async (sessionId: string, content: string, onDelta: (delta: string) => void, signal: AbortSignal, replaceFromMessageId?: string, model: DailyModel = 'deepseek-medium') => {
    const response = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ content, replaceFromMessageId, model }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `Daily chat service error (${response.status})`);
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
        try { const delta = JSON.parse(data).delta; if (typeof delta === 'string') onDelta(delta); } catch { /* Keep-alive. */ }
      }
    }
  },
};
