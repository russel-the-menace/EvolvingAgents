import type { Message } from './types';

export type BoundedTranscript = {
  messages: Message[];
  omitted: Array<Pick<Message, 'id' | 'role' | 'createdAt'> & { reason: string; charCount: number }>;
  budgetChars: number;
  usedChars: number;
  totalMessages: number;
  strategy: 'full_transcript' | 'bounded_transcript';
};

export function compileFormalTranscript(messages: Message[], budgetChars = 24_000, recentCount = 8): BoundedTranscript {
  const budget = Math.max(2_000, budgetChars);
  const recent = messages.slice(-Math.max(1, recentCount));
  const older = messages.slice(0, Math.max(0, messages.length - recent.length));
  let remaining = budget;
  const selectedIds = new Set<string>();
  const selectFromEnd = (items: Message[]) => {
    const selected: Message[] = [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.content.length > remaining) break;
      selected.unshift(item);
      selectedIds.add(item.id);
      remaining -= item.content.length;
    }
    return selected;
  };
  selectFromEnd(recent);
  selectFromEnd(older);
  const bounded = messages.filter((message) => selectedIds.has(message.id));
  const omitted = messages.filter((message) => !selectedIds.has(message.id)).map((message) => ({
    id: message.id, role: message.role, createdAt: message.createdAt, reason: 'working_context_budget', charCount: message.content.length,
  }));
  return {
    messages: bounded,
    omitted,
    budgetChars: budget,
    usedChars: bounded.reduce((total, message) => total + message.content.length, 0),
    totalMessages: messages.length,
    strategy: omitted.length ? 'bounded_transcript' : 'full_transcript',
  };
}

