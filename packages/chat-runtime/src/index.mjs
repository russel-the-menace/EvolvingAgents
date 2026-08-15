export class ChatRuntimeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function answerRecord(value) {
  const result = typeof value === 'string' ? { content: value } : value;
  if (!result || typeof result.content !== 'string' || !result.content.trim()) throw new ChatRuntimeError('Chat answer must contain content.', 502);
  return result;
}

export function createChatRuntime(history, { titleLength = 48 } = {}) {
  for (const method of ['getSession', 'addMessage', 'updateSession', 'truncateSession']) if (typeof history?.[method] !== 'function') throw new Error(`Chat history must provide ${method}().`);
  return {
    async run({ sessionId, content, replaceFromMessageId, beforeMessage, createAnswer, afterAnswer }) {
      const text = String(content || '').trim();
      if (!text) throw new ChatRuntimeError('A message is required.');
      let session = history.getSession(sessionId);
      if (!session) throw new ChatRuntimeError('Conversation was not found.', 404);
      if (replaceFromMessageId && !history.truncateSession(sessionId, replaceFromMessageId)) throw new ChatRuntimeError('The message to edit was not found.', 404);
      const context = await beforeMessage?.({ session, content: text });
      history.addMessage(sessionId, { role: 'user', content: text });
      session = history.getSession(sessionId);
      if (session.messages.filter((message) => message.role === 'user').length === 1) history.updateSession(sessionId, { title: text.slice(0, titleLength) });
      session = history.getSession(sessionId);
      let answer = answerRecord(await createAnswer({ session, messages: session.messages.map(({ role, content }) => ({ role, content })), content: text, context }));
      if (afterAnswer) answer = answerRecord(await afterAnswer({ ...answer, session, userContent: text, context }));
      history.addMessage(sessionId, { role: 'assistant', content: answer.content });
      return { ...answer, session: history.getSession(sessionId) };
    },
  };
}
