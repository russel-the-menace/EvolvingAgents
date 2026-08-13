# Daily Conversation

## Role

Daily conversation is the primary MindClone experience and the default desktop page. It is where the user naturally talks through work, ideas, uncertainty, decisions, and lived experience. Import tools are secondary because most useful long-term context emerges through conversation.

## Runtime model

DeepSeek serves the conversational turn. Its stronger online-model quality is used for natural follow-up questions, nuanced discussion, and helping the user articulate material that is not yet well-formed.

The local store owns the relationship: it keeps each full conversation, the approved-memory library, and the candidate-memory review queue. DeepSeek receives only the recent conversation window and approved memories needed for the current turn. It does not become the database of record.

## Learning behavior

1. Each user and assistant turn is saved locally as part of a daily session by default.
2. The conversation continues immediately after the assistant response.
3. After each completed turn, a lightweight local rule decides whether the user's message contains enough experience, preference, viewpoint, or other durable context to extract.
4. When it does, the current turn is copied to a local source document and DeepSeek asynchronously proposes memories from it.
5. The proposal is placed in the same pending-review queue as file imports.
6. Only an explicit user approval makes a memory available to later preparation and conversation context.

Extraction is intentionally asynchronous. The user never waits for memory indexing before continuing a thought.

## Conversation control

The sidebar follows a single-column ChatGPT-style layout: navigation, search, and conversation history share one collapsible sidebar. Search is local and matches saved conversation titles and text. The user can delete an entire conversation or a single message; deleting a user message also deletes its immediate assistant reply and any source documents or candidate memories that were derived from those deleted messages.

## Composer attachments

The `+` control next to the daily composer is the supplementary ingestion surface:

- ChatGPT `conversations.json` import
- Pasted text or Markdown
- Future: files, Gemini Takeout, and voice-note transcription

These are written to the local inbox, then manually extracted and reviewed. They do not alter the current conversation unless the user chooses to discuss them.

## Relation to formal interview mode

Daily conversation uses DeepSeek. Formal interview mode continues to use the local model and frozen interview packet for latency and predictable behavior. The approved memories created in daily chat will later be retrieved when a new interview packet is prepared.
