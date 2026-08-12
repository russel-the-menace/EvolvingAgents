# Memory Ingestion and Review

## Status

Planned. This module is documented before implementation because it determines the long-term quality of MindClone.

## Responsibility

Accept Markdown notes, resumes, chat exports, interview debriefs, and guided conversations. Convert raw material into reviewable memories: experience facts, evidence, skills, preferences, viewpoints, language examples, and uncertainty notes.

## Proposed flow

1. Store the original local document with source and timestamp.
2. Chunk and extract candidate memories asynchronously.
3. Optionally use Gemini/GPT to label, summarize, find contradictions, and suggest interview-ready stories.
4. Present candidate memories for user approval, correction, merge, or rejection.
5. Index approved memories locally for retrieval by interview preparation.

## Design decisions

- One experience graph, not fixed role personas: the same experience can support engineering, support, operations, sales, or remote-work discussions when relevant to a JD.
- Provenance is mandatory: every formal memory must cite its source fragment or user confirmation. This makes later correction possible.
- Retrieval changes emphasis, not history: a JD changes which stories are selected and in what order they are explained; it does not rewrite the underlying record.
- Cloud models are allowed only before approval: a cloud model may help organize material but cannot silently become the source of truth.
- Start with Markdown and SQLite-backed metadata/indexing: plain source files remain portable and inspectable. Add a vector index only once semantic retrieval measurably improves over keyword and tag retrieval.

## Interface with formal mode

Preparation retrieves approved evidence and compiles it into the packet. Formal mode never waits for ingestion, extraction, embedding, or cloud requests.
