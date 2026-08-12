# MindClone Architecture

## Product boundary

MindClone helps prepare and rehearse candidate answers. It does not replace the candidate: the candidate reads and answers in their own words. The purpose is to select the relevant parts of one evolving experience and knowledge base for a specific interview, then provide a fast, coherent response during a live rehearsal.

## Two paths

| Path | Purpose | Latency rule | Model policy |
| --- | --- | --- | --- |
| Write path | Import notes, chat exports, resumes, interview debriefs, and guided conversations | Asynchronous; may be slow | DeepSeek is the initial cloud extractor. Nothing becomes formal memory without review. |
| Read path | Answer an interviewer's current question | First token in seconds; generation must be cancellable | Local, already-running model only. No cloud call, long extraction, or re-indexing. |

## Interview packet

The packet is the bridge between both paths. Before an interview, the user supplies the JD and the exact resume submitted. Preparation extracts the role's requirements, selects relevant existing evidence, and writes a compact answer strategy. User confirmation freezes this packet. The formal conversation uses only the frozen packet, the approved memory store, and short-term turn history.

This prevents a JD change or late cloud analysis from changing the meaning of an answer halfway through a follow-up question.

## Planned components

1. `daily-conversation`: default experience. DeepSeek-led daily dialogue with local session persistence and asynchronous memory proposals.
2. `desktop-workbench`: local Electron UI for preparation, rehearsal, model status, and later voice controls.
3. `interview-engine`: packet creation, prompt assembly, streaming output, interruption, and turn consistency.
4. `memory-ingestion`: asynchronous import, cloud-assisted extraction, candidate-memory review, and local indexing.
5. `audio-bridge`: later, permissioned microphone/system-audio transcription and diarization. It will produce text events for the interview engine and never bypass its session model.

## Model policy

The starting runtime is a quantized Qwen 7B instruction model served locally by Ollama or MLX-LM. The model is chosen for Chinese and mixed Chinese-English capability within M1 Pro 16GB constraints. The exact model is configurable because the latency and answer quality benchmark, rather than a model name, decides the production choice.

DeepSeek is the initial cloud model for daily conversation and write-path extraction, contradiction detection, and interview-debrief coaching. Gemini/GPT remain optional future providers. All cloud providers are intentionally absent from the formal answer path.
