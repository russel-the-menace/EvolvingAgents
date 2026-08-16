function normalizeMessage(message) {
  return {
    id: String(message?.id || ''),
    role: String(message?.role || 'user'),
    content: String(message?.content || ''),
    createdAt: message?.createdAt || null,
  };
}

function chars(value) {
  return String(value || '').length;
}

function takeFromEnd(items, budget, used) {
  const selected = [];
  let remaining = budget - used;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const cost = chars(item.content);
    if (cost > remaining) break;
    selected.unshift(item);
    remaining -= cost;
  }
  return { selected, used: budget - remaining };
}

/**
 * Keeps the complete transcript as input, but creates a bounded model view.
 * ponytail: one bounded working prompt is intentional; summaries/evidence are the next upgrade for omitted history.
 */
export function compileTranscript(messages, options = {}) {
  const budgetChars = Math.max(2_000, options.budgetChars || 24_000);
  const summary = options.summary?.content ? { ...options.summary, content: String(options.summary.content) } : null;
  const summaryChars = Math.min(chars(summary?.content), Math.floor(budgetChars / 3));
  const messageBudget = budgetChars - summaryChars;
  const normalized = (messages || []).map(normalizeMessage).filter((item) => item.content.trim());
  const recentCount = Math.max(1, options.recentCount || 8);
  const recent = normalized.slice(-recentCount);
  const older = normalized.slice(0, Math.max(0, normalized.length - recent.length));
  const recentResult = takeFromEnd(recent, messageBudget, 0);
  const olderBudget = Math.max(0, messageBudget - recentResult.used);
  const olderResult = olderBudget ? takeFromEnd(older, olderBudget, 0) : { selected: [], used: 0 };
  const selectedIds = new Set([...olderResult.selected, ...recentResult.selected].map((item) => item.id));
  const selected = normalized.filter((item) => selectedIds.has(item.id));
  const omitted = normalized.filter((item) => !selectedIds.has(item.id)).map((item) => ({
    id: item.id, role: item.role, createdAt: item.createdAt, reason: 'working_context_budget', charCount: chars(item.content),
  }));
  return {
    messages: selected,
    omitted,
    summary: omitted.length && summary ? { ...summary, content: summary.content.slice(0, summaryChars) } : null,
    budgetChars,
    usedChars: selected.reduce((total, item) => total + chars(item.content), 0) + (omitted.length && summary ? summaryChars : 0),
    totalMessages: normalized.length,
    omittedMessages: omitted.length,
    strategy: omitted.length ? 'bounded_transcript' : 'full_transcript',
  };
}

export function contextAuditText(context) {
  return `Context audit: strategy=${context.strategy}; messages=${context.messages.length}/${context.totalMessages}; usedChars=${context.usedChars}/${context.budgetChars}; omitted=${context.omittedMessages}.`
    + (context.omittedMessages ? ' Older messages were retained in storage but omitted from this working prompt pending summary/evidence retrieval.' : '');
}
