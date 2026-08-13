# Memory Ingestion and Review

## Status

Initial local vertical slice implemented. The current UI supports ChatGPT `conversations.json`, pasted text/Markdown, manually recorded interview notes, and Douyin share messages paired with a reviewable voice transcript. Imported raw content and candidate-review state are saved locally in `data/memory-store.json`.

## Responsibility

Accept Markdown notes, resumes, chat exports, interview debriefs, and guided conversations. Convert raw material into reviewable memories: experience facts, evidence, skills, preferences, viewpoints, language examples, and uncertainty notes.

The knowledge base has two distinct scopes:

- Personal memory: the user's own experience, skills, preferences, and viewpoints. These candidates require explicit approval before they are treated as facts about the user.
- Learned knowledge: frameworks, concepts, answer patterns, and clearly attributed third-party examples from learning materials. Short-video imports enter this scope and become available to help reason about an answer immediately. They must never be represented as the user's personal history.

When answering, MindClone combines learned knowledge for the reasoning with approved personal memory for the user's own evidence, judgment, and expression.

For short video sources, MindClone stores the original Douyin share message and link alongside the spoken transcript. It learns from the transcript only: no video frames, OCR, or visual subtitles are processed. The local server uses TiKHub's hybrid video parsing API to obtain media, extracts a temporary audio-only WAV with `ffmpeg`, and runs the local `whisper.cpp` model. Both source media and audio are deleted after transcription.

## Proposed flow

1. Store the original local document with source and timestamp.
2. Chunk and extract candidate memories asynchronously.
3. Explicitly request DeepSeek to label, summarize, find contradictions, and suggest interview-ready stories.
4. Present candidate memories for user approval, correction, merge, or rejection.
5. Index approved memories locally for retrieval by interview preparation.

## Design decisions

- One experience graph, not fixed role personas: the same experience can support engineering, support, operations, sales, or remote-work discussions when relevant to a JD.
- Provenance is mandatory: every formal memory must cite its source fragment or user confirmation. This makes later correction possible.
- Retrieval changes emphasis, not history: a JD changes which stories are selected and in what order they are explained; it does not rewrite the underlying record.
- Cloud models are allowed only before approval: DeepSeek initially helps organize material but cannot silently become the source of truth.
- The prototype uses an atomic JSON store to validate product flow. Replace it with Markdown originals plus SQLite metadata before adding retrieval to formal interview packets.

## Interface with formal mode

Preparation retrieves approved evidence and compiles it into the packet. Formal mode never waits for ingestion, extraction, embedding, or cloud requests.
