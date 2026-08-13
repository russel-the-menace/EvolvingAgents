# Scene-Conditioned Interview Engine

## Responsibility

Generate an answer that is both recognizably the user and correct for the current interview. The exact resume submitted for that role is authoritative inside the scene, even when the longitudinal conversation contains another professional identity.

## Bounded Autobiographical Override

Preparation compiles a persisted scene snapshot from the job description, submitted resume, audience, goal, and currently authorized cognition. Every snapshot has `writeBack=false`. Its precedence is:

1. submitted resume and explicit scene facts;
2. compatible authorized personal experience;
3. authorized personal viewpoints;
4. understood external knowledge;
5. attributed third-party examples.

The resume can authorize an HR or sales history for that interview. It cannot write that identity into the longitudinal store, and it cannot authorize facts absent from the resume.

## Answer Flow

1. Compile and freeze the scene through `/api/scenes/compile`.
2. Rank knowledge and personal claims separately for each question.
3. Assemble a plan containing claim IDs, experience policy, and follow-up constraints.
4. Stream the plan through the configured local model.
5. Audit the completed answer and persist the run.

The current audit detects unsupported numbers in Chinese and English, first-person claims without an evidence channel, and accidental scene write-back. Clause-level semantic citation and contradiction audits are the next increment.

## Latency and Privacy

Formal mode never waits for extraction, embedding, background study, or a cloud model. The packet and scene snapshot are frozen before questioning. Each generation is cancellable. Daily dialogue and ingestion may use cloud models, but formal interview generation remains local.

## Source

- `server/domain/scenes.mjs`
- `server/domain/answer-audit.mjs`
- `src/interview.ts`
- formal-mode orchestration in `src/App.tsx`
