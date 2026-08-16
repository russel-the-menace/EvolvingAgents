function summaryPrompt(existing, messages) {
  const prior = existing?.content ? `Existing summary covering earlier messages:\n${existing.content}\n\n` : '';
  const transcript = messages.map((message) => `[${message.id}] ${message.role} ${message.createdAt || ''}\n${message.content}`).join('\n\n');
  return `Maintain a provenance-aware summary of a long-running personal conversation.

Preserve chronology, speaker ownership, direct user experiences, preferences, viewpoints, uncertainty, negation, changed beliefs, unresolved questions, commitments, dates, and numbers. Never convert assistant suggestions or external material into the user's experience or belief. Keep message IDs beside consequential facts so the summary can be traced back to the original transcript. Do not add facts.

${prior}New original messages:\n${transcript}\n\nReturn only the updated summary.`;
}

export async function refreshConversationSummary({ repository, gateway, sessionId, keepRecent = 8, minNewMessages = 8 }) {
  const all = repository.listMessagesForSummary(sessionId);
  const throughOrdinal = all.length - keepRecent - 1;
  if (throughOrdinal < 0) return null;
  const existing = repository.getActiveContextSummary(sessionId);
  const afterOrdinal = existing?.coveredThroughOrdinal ?? -1;
  if (throughOrdinal - afterOrdinal < minNewMessages) return existing || null;
  const newMessages = repository.listMessagesForSummary(sessionId, afterOrdinal, throughOrdinal);
  if (!newMessages.length) return existing || null;
  const content = await gateway.complete([
    { role: 'system', content: 'You update faithful, source-traceable conversation summaries.' },
    { role: 'user', content: summaryPrompt(existing, newMessages) },
  ], { quality: 'Medium' });
  const messageIds = [...new Set([...(existing?.messageIds || []), ...newMessages.map((message) => message.id)])];
  const id = repository.replaceContextSummary({ sessionId, content, messageIds, coveredThroughOrdinal: throughOrdinal });
  return repository.getActiveContextSummary(sessionId) || { id, content, messageIds, coveredThroughOrdinal: throughOrdinal };
}

