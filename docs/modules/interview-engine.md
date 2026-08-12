# Interview Engine

## Responsibility

The interview engine turns a frozen interview packet and short-term transcript into a candidate answer. It is the latency-critical read path.

## Input and output

Input: packet, current transcript, local model settings, and the newest interviewer question.

Output: a streamed candidate-answer draft. The user reads and adapts it; it is not spoken automatically in the current version.

## Design decisions

- OpenAI-compatible streaming protocol: Ollama exposes it directly and MLX-LM can be adapted behind the same contract. This keeps the UI independent of the runtime.
- Browser `AbortController`: each generation owns a cancellation token. A new question aborts the old request before creating the new one.
- Frozen packet: JD and resume cannot drift during a live thread. Follow-ups use the transcript as a consistency constraint.
- Bounded answer length: answers should start with the point, then provide evidence suitable for reading aloud. The prompt directs the model to avoid generic filler.
- No cloud fallback: failure should be visible. Silently falling back to Gemini/GPT would violate the response-time and privacy model.

## Model baseline

Use a quantized Qwen 7B instruct model first on M1 Pro 16GB. Test first-token latency, tokens per second, Chinese fluency, English switching, and whether it maintains consistency across follow-ups. Only increase model size if measured quality is insufficient and latency remains acceptable.

## Source

- `src/interview.ts`
- relevant session behavior in `src/App.tsx`
