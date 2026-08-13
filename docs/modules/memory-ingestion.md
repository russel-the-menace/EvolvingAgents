# Memory Ingestion and Epistemic Authorization

## Responsibility

Convert conversations, notes, resumes, papers, articles, podcasts, and speech transcripts into claims without losing who originally said or experienced them. The module controls both epistemic state and representational authority.

## Source Classes

- Personal sources provide possible evidence about the user. Extracted claims begin as `observed/none` and require review.
- External learning sources provide knowledge and third-party examples. Extracted claims enter `understood/reasoning_use` automatically.
- A third-party example remains third-party even when it is relevant, memorable, or repeatedly retrieved.

## Internalization

The UI action “Discuss and adopt” asks for the user's own formulation and the reason it was adopted. The API does not relabel the external claim. It creates a separate `user/endorsed/personal_view` claim, links it to the source by `internalized_as`, and records an authorization event.

This is the first implementation of Endorsement-Gated Cognitive Assimilation. Later versions will accept multi-turn discussion or evidenced application instead of requiring one explicit action.

## Short Video Flow

1. Parse the user-supplied Douyin share text.
2. Resolve media metadata through TiKHub.
3. Download media to a temporary directory.
4. Extract a mono 16 kHz WAV with `ffmpeg`.
5. Transcribe locally with `whisper.cpp`.
6. Store the original share text, URL, topics, and speech transcript.
7. Delete temporary media and audio.
8. Extract speech-derived knowledge as external cognition.

No video frame, OCR, facial, or scene analysis is performed.

## Deletion and Revision

Rejected and superseded claims leave the active cognition view and cannot be reauthorized by an invalid state transition. Original conversations remain as source evidence. A future tombstone layer will prevent a deliberately rejected old view from being re-extracted from unchanged source text.

## Source

- `server/domain/cognition.mjs`
- `server/infrastructure/database.mjs`
- `server/infrastructure/video-transcription.mjs`
- memory routes in `server/index.mjs`
