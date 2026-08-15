export function responseText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  throw new Error('Gateway returned no assistant message.');
}

export function createModelGateway({ baseUrl, apiKey, provider = 'deepseek', timeoutMs = 120_000, fetchImpl = fetch }) {
  if (!baseUrl || !apiKey) throw new Error('Gateway baseUrl and apiKey are required.');
  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  return {
    async complete(messages, { quality = 'Medium', signal } = {}) {
      if (!Array.isArray(messages) || !messages.length) throw new Error('Gateway messages must be a non-empty array.');
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, quality, messages }), signal: requestSignal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(body.error?.message || body.error || `Gateway request failed (${response.status}).`); error.status = response.status; throw error; }
      return responseText(body);
    },
  };
}
