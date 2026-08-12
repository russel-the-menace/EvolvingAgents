# Cloud Preparation Provider

## Status

Planned integration. This module will serve the asynchronous write path only.

## Initial provider

DeepSeek is the initial provider because the project has a configured API key and its OpenAI-compatible chat interface is sufficient for structured extraction. Configuration is local-only in `.env`; copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY`. The renderer must never receive this key.

## Responsibility

Given raw imported material, propose structured candidate memories, tags, story summaries, contradictions, and clarifying questions. It does not answer a live interview question and it cannot write directly to the approved memory store.

## API boundary

The future local backend process owns this provider. The desktop renderer sends only selected import text to a loopback API; the backend reads `.env`, calls DeepSeek, validates structured JSON, and stores a reviewable proposal locally. This avoids exposing credentials in Electron's renderer or a browser bundle.

## Why not use it for formal interviews

Network startup, provider variability, privacy scope, and request cancellation make cloud inference unsuitable for the seconds-level read path. Formal mode stays on the already-running local model.
