# Learning Engine

`@evolving-agents/learning-engine` is a domain-neutral source-to-evidence retrieval kernel. It is deliberately not a chatbot, crawler, model SDK, identity system, or vector database.

## What It Owns

- source persistence and checksum deduplication;
- semantic-size text chunking with offsets;
- pluggable claim extraction;
- atomic claim and evidence persistence;
- claim-to-source provenance;
- replacement of stale source derivations;
- SQLite FTS retrieval;
- validity-window filtering;
- pluggable retrieval, policy, and reranking;
- compact citation-ready evidence contexts.

## What A Domain Must Supply

```js
const engine = createLearningEngine({
  store,
  extractor: { extract: async ({ source, chunk, context }) => proposals },
  policy: {
    mapProposal: ({ proposal, source, chunk, context }) => ({ claim, evidence }),
    canRetrieve: ({ claim, evidence, query, context, now }) => true,
    beforeReplaceSource: optionalHook,
    afterLearn: optionalHook,
  },
  retrievers: [optionalLexicalOrVectorRetriever],
  reranker: optionalReranker, // returned order is final
  chunking: { maxChars: 6000, overlapChars: 300 },
});
```

The extractor may use Gemini, GPT, DeepSeek, a local model, deterministic parsing, or a combination. It must return structured proposals. The policy defines domain meaning and authority. MindClone maps proposals to epistemic ownership; the campus example maps them to policy authority, access scope, and validity.

## API

```js
const { source, duplicate } = await engine.ingest({
  title, sourceType, content, sourceUri, sourceActor, metadata,
});

const { chunks, claims } = await engine.learn(source.id);

const results = await engine.retrieve(question, {
  now: new Date().toISOString(),
  context: { accessScopes: ['public'] },
  limit: 8,
});

const evidence = engine.buildEvidenceContext(results);
```

## Consuming The Package

Inside the Evolving Agents monorepo, applications depend on `@evolving-agents/learning-engine` through npm workspaces. Do not copy the package into each application. The runtime uses only Node built-ins and receives an already-open `node:sqlite` database. A consuming application must:

1. open SQLite and call `createSqliteLearningStore(db)`;
2. implement an extractor;
3. implement `mapProposal` and `canRetrieve`;
4. pass source metadata needed by those policies;
5. assemble the returned evidence into its own answer prompt;
6. test domain-specific authority, expiry, conflict, and abstention behavior.

See `apps/campus-atlas/src/learning.mjs` in the monorepo for an authenticated university-policy configuration.

## Production Limits

Version `0.1.0` is an extracted kernel, not a complete production RAG platform. Before indexing a large website estate, add:

- HTML/PDF/Office/OCR parsers and a crawl scheduler outside this package;
- encrypted credential storage outside this package;
- a vector retriever through `retrievers` and a semantic reranker;
- source version reconciliation and authority/conflict policies;
- table-aware chunks and attachment relationships;
- citation entailment checks and answer-level abstention;
- operational metrics, retry queues, and incremental indexing.

Do not put cookies, passwords, session tokens, or API keys in source metadata, chunks, claims, embeddings, logs, or model prompts.
`ingest` rejects common credential keys in nested metadata. Keep authenticated-session material in the crawler's encrypted credential store and pass only non-secret provenance into this package.
