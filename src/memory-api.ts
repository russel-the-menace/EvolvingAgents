import type { MemoryCandidate, MemoryDocument } from './types';

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
};
