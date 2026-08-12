import type { DailySession, MemoryCandidate, MemoryDocument } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `本地记忆服务异常（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export const memoryApi = {
  list: () => request<{ documents: MemoryDocument[]; memories: MemoryCandidate[] }>('/memory'),
  importDocument: (payload: Pick<MemoryDocument, 'title' | 'sourceType' | 'content'>) =>
    request<{ document: MemoryDocument }>('/memory/documents', { method: 'POST', body: JSON.stringify(payload) }),
  extract: (documentId: string) =>
    request<{ memories: MemoryCandidate[] }>('/memory/extract', { method: 'POST', body: JSON.stringify({ documentId }) }),
  setStatus: (id: string, status: MemoryCandidate['status']) =>
    request<{ memory: MemoryCandidate }>(`/memory/candidates/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  listSessions: () => request<{ sessions: DailySession[] }>('/chat/sessions'),
  createSession: () => request<{ session: DailySession }>('/chat/sessions', { method: 'POST' }),
  streamChat: async (sessionId: string, content: string, onDelta: (delta: string) => void, signal: AbortSignal) => {
    const response = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ content }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `日常对话服务异常（${response.status}）`);
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
