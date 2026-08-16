export function responseText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  throw new Error('Gateway returned no assistant message.');
}

export function responseDelta(body) {
  const content = body?.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

function requestSignal(signal, timeoutMs) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

async function gatewayError(response) {
  const body = await response.json().catch(() => ({}));
  const error = new Error(body.error?.message || body.error || `Gateway request failed (${response.status}).`);
  error.status = response.status;
  return error;
}

export function createModelGateway({ baseUrl, apiKey, provider = 'deepseek', timeoutMs = 120_000, fetchImpl = fetch }) {
  if (!baseUrl || !apiKey) throw new Error('Gateway baseUrl and apiKey are required.');
  const root = baseUrl.replace(/\/$/, '');
  const endpoint = `${root}/v1/chat/completions`;
  return {
    async uploadFile({ name, type, data }, { signal } = {}) {
      if (!name || !type || !(data instanceof Uint8Array) || !data.length) throw new Error('Gateway file name, type, and data are required.');
      const form = new FormData();
      form.append('purpose', 'user_data');
      form.append('file', new Blob([data], { type }), name);
      const response = await fetchImpl(`${root}/v1/files`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: requestSignal(signal, timeoutMs) });
      if (!response.ok) throw await gatewayError(response);
      const body = await response.json().catch(() => ({}));
      if (typeof body.id !== 'string' || !body.id) throw new Error('Gateway returned no file ID.');
      return body.id;
    },
    async complete(messages, { quality = 'Medium', signal } = {}) {
      if (!Array.isArray(messages) || !messages.length) throw new Error('Gateway messages must be a non-empty array.');
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, quality, messages }), signal: requestSignal(signal, timeoutMs) });
      if (!response.ok) throw await gatewayError(response);
      const body = await response.json().catch(() => ({}));
      return responseText(body);
    },
    async stream(messages, { quality = 'Medium', signal, onDelta = () => {} } = {}) {
      if (!Array.isArray(messages) || !messages.length) throw new Error('Gateway messages must be a non-empty array.');
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, quality, messages, stream: true }), signal: requestSignal(signal, timeoutMs) });
      if (!response.ok) throw await gatewayError(response);
      if (!response.body) throw new Error('Gateway returned no response stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let answer = '';
      const consume = (line) => {
        if (!line.startsWith('data:')) return false;
        const data = line.slice(5).trim();
        if (!data) return false;
        if (data === '[DONE]') return true;
        const body = JSON.parse(data);
        if (body.error) throw new Error(body.error?.message || body.error);
        const delta = responseDelta(body);
        if (delta) { answer += delta; onDelta(delta); }
        return false;
      };
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) if (consume(line)) return answer;
        if (done) break;
      }
      if (pending && consume(pending)) return answer;
      if (!answer.trim()) throw new Error('Gateway returned no assistant message.');
      return answer;
    },
  };
}
