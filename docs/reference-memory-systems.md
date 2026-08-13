# Memory System References

## Scope

MindClone is not a generic chat-memory application. It must combine two different kinds of context when helping the user answer a question:

1. **Personal evidence**: the user's real experience, responsibilities, preferences, decisions, and changing circumstances.
2. **Learned knowledge**: frameworks, concepts, methods, third-party cases, and answer patterns learned from videos, articles, and courses.

The response must use learned knowledge to reason, personal evidence to establish what the user can honestly claim, and an explicit bridge between them to form the user's own view. A source author's experience must never be attributed to the user.

The repositories below are local, read-only implementation references under `reference-project/`. They are not production dependencies.

| Reference | Local revision | Core files reviewed | What it contributes |
| --- | --- | --- | --- |
| [Mem0](../reference-project/mem0) | `14c4317` | `mem0/memory/main.py`, `mem0/configs/base.py` | Incremental ADD / UPDATE / DELETE memory lifecycle and scoped semantic retrieval. |
| [Graphiti](../reference-project/graphiti) | `d40da88` | `graphiti_core/nodes.py`, `edges.py`, `graphiti.py` | Episode provenance, temporal facts, entity summaries, and hybrid graph retrieval. |
| [HippoRAG 2](../reference-project/HippoRAG) | `c617143` | `HippoRAG.py`, `information_extraction/openie_openai.py`, triple prompts | Entity-relation extraction plus dense retrieval and graph reranking for multi-hop questions. |
| [Microsoft GraphRAG](../reference-project/graphrag) | `14a00ad` | `docs/index/architecture.md`, `data_model/text_unit.py`, claim extraction | Source chunking, claims, entity graph, topic/community summaries, and staged indexing. |

## What We Learned

### Mem0: memory is a lifecycle, not an append-only list

Mem0's `add()` first retrieves related stored items, then asks an LLM to decide whether to add, update, or delete. `update()` records a history event and refreshes the item's retrieval representation.

MindClone mapping:

- A personal claim needs a stable identity and revision history. A new conversation can supersede an old role, preference, or goal rather than creating contradictory duplicates.
- Learning claims should also be deduplicated and merged, but never silently mutate a personal claim.
- Source scope and ownership are required filters for every retrieval query.

Not adopted directly:

- Mem0's generic memory text model is too flat to represent the relationship between learned knowledge, an experience, and a personal viewpoint.
- Its external vector-store-first deployment is unnecessarily heavy for the current local desktop application.

### Graphiti: preserve episodes and time

Graphiti stores raw episodes separately from derived entities and relationships. Its episodic nodes hold source content, source description, metadata, and a reference time (`valid_at`). Facts/edges have validity windows so an old statement can remain historically true without appearing as current truth.

MindClone mapping:

- Every imported video, transcript, chat turn, note, and resume fragment is an immutable `source` plus `evidence_chunk`.
- Personal facts need `observed_at`, `valid_from`, `valid_to`, `created_at`, and `superseded_by` where applicable.
- A source's author, speaker, and platform must remain visible in provenance. Third-party cases are knowledge examples, not personal evidence.

Not adopted directly:

- Neo4j/Kuzu/FalkorDB is not justified for a single-user desktop app at this stage. SQLite relation tables provide the needed first version of the graph.
- Automatic fact invalidation should remain reviewable for personal facts.

### HippoRAG: retrieve connected evidence, not isolated snippets

HippoRAG indexes passages, entities, and OpenIE triples separately. At query time it combines dense passage signals, fact selection, and Personalized PageRank-style graph reranking. This is aimed at questions whose answer requires several connected pieces of knowledge.

MindClone mapping:

- Extract entities and typed relations from learning materials and personal evidence: `HR management -> supports -> business goal`, `experience -> demonstrates -> stakeholder alignment`.
- Query retrieval should begin with lexical/semantic seeds and expand one or two graph hops, then return the specific evidence chunks that support the answer.
- The first local version can implement a weighted neighborhood expansion in SQLite; PageRank is a later optimization once the graph is large enough to require it.

Not adopted directly:

- Full RDF/OpenIE pipelines are too error-prone for short, noisy ASR transcripts. MindClone should use a constrained domain schema and retain the evidence quote for every relation.

### Microsoft GraphRAG: material needs multiple levels of abstraction

GraphRAG transforms documents into TextUnits, extracts entities and claims, groups connected concepts into communities, and produces community reports. Its indexing design makes raw evidence, individual claims, and theme-level summaries separate query targets.

MindClone mapping:

- Split a transcript into evidence chunks before extracting claims. Do not treat a whole video as a single note.
- Maintain claim-level records such as "HR management aligns people and mechanisms to business goals" with source quotes and confidence.
- Build topic summaries only after several related claims exist. Examples: `HR management`, `sales methodology`, `backend reliability`.
- Answer a narrow question from claims and evidence; answer a broad question from topic summaries plus selected supporting claims.

Not adopted directly:

- Community detection and global reports are expensive and premature for the current corpus size. Run topic synthesis lazily by topic, after a material threshold is reached.

## Target Local Model

```text
Source
  -> EvidenceChunk
      -> Claim --about--> Concept
      -> Claim --supports/contradicts--> Claim
      -> PersonalExperience --demonstrates--> Claim
      -> Perspective --adopts/challenges--> Claim
      -> AnswerPlan --uses--> Claim + PersonalExperience + Perspective
```

The first SQLite schema should contain:

| Table | Purpose |
| --- | --- |
| `sources` | Immutable imported material and provenance: platform, author/speaker, URL, timestamps, source scope. |
| `evidence_chunks` | Small source passages with offsets or transcript timestamps. |
| `claims` | Atomic knowledge or personal assertions, scope, status, confidence, temporal validity, and normalized text. |
| `claim_evidence` | Many-to-many citation links from claims to evidence chunks. |
| `concepts` | Normalized domain concepts and aliases. |
| `claim_concepts` | Links claims to concepts and roles such as subject, predicate, or object. |
| `claim_relations` | Typed links: supports, contradicts, causes, enables, exemplifies, supersedes. |
| `experiences` | User-owned, reviewable real-world episodes with role, action, outcome, and time range. |
| `experience_claims` | States which learned claims an experience demonstrates, challenges, or contextualizes. |
| `perspectives` | User-owned interpretations that cite both learned claims and personal evidence. |
| `answer_plans` | Reusable question-specific reasoning plans and their cited components. |

## Retrieval Contract

For every question, assemble context in this order:

1. Classify the question and identify likely concepts.
2. Retrieve high-relevance claims with hybrid lexical/semantic scoring, filtered by scope and status.
3. Expand to directly related claims and supporting evidence chunks.
4. Retrieve approved personal experiences linked to those claims or concepts.
5. Retrieve existing user perspectives and answer plans.
6. Produce an answer with labels in the internal prompt:
   - `knowledge`: reusable material that can support reasoning.
   - `personal evidence`: facts the user can honestly say they did or observed.
   - `personal perspective`: the user's own interpretation.
   - `third-party example`: illustrative only; never claim as the user's history.
7. When no personal evidence exists, state the reasoning as an informed view rather than invented experience.

## Delivery Sequence

1. Replace the JSON memory store with SQLite while preserving existing sources and approved memories.
2. Introduce `sources`, `evidence_chunks`, `claims`, and `claim_evidence`; migrate short-video knowledge cards into claims.
3. Add a constrained concept/relation extractor for learning materials and personal sources.
4. Add `experiences`, `perspectives`, and explicit experience-to-claim linking in the review UI.
5. Replace keyword-only retrieval with SQLite full-text search plus concept-neighborhood expansion.
6. Add answer plans and answer provenance so the user can inspect why a response used a given framework or experience.
7. Add embeddings and graph-based reranking only when corpus size makes FTS plus relation traversal insufficient.

## Evaluation

The project should maintain a small local evaluation set inspired by LongMemEval's concerns:

- Correctly distinguish third-party material from the user's experience.
- Retrieve a framework and the relevant personal evidence for the same question.
- Respect changes over time, such as a current role replacing an older role.
- Identify when no personal experience supports a claim.
- Return citations to the source chunks used for each major answer point.
