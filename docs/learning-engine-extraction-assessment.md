# Learning Engine Extraction Assessment

## Decision

Extract the engine and reuse it. Do not fork the full MindClone application for each domain. The engine now remains an internal workspace package until multiple real applications stabilize its API.

The extracted `packages/learning-engine` passed the decisive test: the CampusAtlas adapter learned a Chinese authenticated policy, retained the publishing authority and source quote, denied retrieval without the required access scope, allowed retrieval for an authenticated student, excluded the expired policy, abstained on an unrelated query, and returned citation-ready evidence without modifying engine source code. MindClone also uses the same workspace package for its real ingestion and daily retrieval paths.

This supports reuse as a source-to-evidence learning kernel. It does not support claiming that the package alone is a finished campus RAG product.

## Evaluation Standard

Each dimension is scored from 0 to 5. Extraction requires all hard gates and at least 32/40 overall.

| Dimension | Hard gate | Result | Evidence |
| --- | ---: | ---: | --- |
| Domain independence | Yes | 5/5 | Core source contains no MindClone, resume, interview, school, or scholarship concepts. |
| Dependency direction | Yes | 5/5 | Applications inject extractor, policy, retrievers, and reranker; the core does not import app code. |
| Data-model generality | Yes | 4/5 | Source, evidence, claim, relation, attributes, validity, and provenance support both tested domains. Rich tables and binary artifacts remain external. |
| Second-domain proof | Yes | 5/5 | The `apps/campus-atlas` policy test imports its real adapter and passes without engine edits. |
| Retrieval extensibility | Yes | 4/5 | SQLite FTS is operational; multiple retrievers and reranking are injectable. No bundled embedding implementation. |
| Lifecycle correctness | Yes | 4/5 | Checksums, re-extraction replacement, stale search cleanup, evidence cascade, and temporal filtering are tested. Cross-source supersession is domain policy. |
| Testability | Yes | 5/5 | Deterministic in-memory tests require no model or network and run with the repository suite. |
| Adoption cost | No | 4/5 | One workspace dependency plus an extractor and policy adapter. It is not yet published as a versioned npm package. |

**Total: 36/40. Hard gates: all passed.**

## Why The Whole MindClone Cognition Layer Was Not Extracted

MindClone's endorsement gate, personal-experience ownership, viewpoint internalization, resume override, and first-person audit are valid but domain-specific. A campus system does not ask whether a scholarship rule is the user's belief. It asks who published the rule, when it is valid, whom it applies to, and whether the current user may retrieve it.

Putting both policy families into the core would create boolean options and domain nouns throughout the engine. That would make future projects modify the core rather than configure it, failing the second-domain criterion.

## Stable Core Boundary

The reusable core owns:

```text
source -> chunk -> extractor -> policy mapping -> claim/evidence store
       -> lexical/vector candidates -> policy filter -> reranker
       -> citation-ready evidence context
```

Domain applications own:

- acquisition connectors and credential handling;
- document-specific parsing;
- extraction schema and model prompt;
- authority, access, conflict, and validity rules;
- response prompt, citations, abstention, and UI;
- domain-specific evaluation data.

## CampusAtlas Effort

The campus project should start from this package rather than from zero, but it still needs substantial application work:

1. authenticated browser/crawler and encrypted cookie vault;
2. HTML, PDF, Word, Excel, scanned-PDF, and attachment parsers;
3. policy extractor for eligibility, deadlines, amounts, exceptions, cohorts, departments, and authority levels;
4. embedding retriever and reranker for large-scale semantic recall;
5. version/supersession and cross-document conflict resolution;
6. answer composition with paragraph-level citations and abstention;
7. authorization tests proving private sources never leak across users.

The engine removes the need to rebuild persistence, chunk lifecycle, provenance, basic retrieval contracts, validity filtering, and evidence packaging. It does not remove the need to build the campus domain.

Authenticated acquisition credentials must remain outside the learning database. The engine rejects common credential keys in source metadata so a crawler cannot accidentally persist cookies, access tokens, or passwords with learned content.

## Reuse Rule For Future Domains

Create a new domain pack when the project can express its differences through extractor output, source metadata, policy hooks, retrieval plugins, reranking, and answer composition. Start a separate engine only if the project requires a fundamentally different unit of knowledge or storage/retrieval contract, such as continuous sensor streams, pixel-level visual memory, transactional state with serializable business operations, or a training-first parameter update pipeline.
