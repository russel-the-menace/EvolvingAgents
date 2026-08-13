# MindClone: Epistemic Authorization and Bounded Autobiographical Overrides for Scene-Conditioned Personal Agents

**Manuscript type:** System paper and preregistered evaluation protocol  
**Version:** 1.0 (first implementation manuscript; human evaluation pending)  
**Date:** 13 August 2026

## Abstract

Longitudinal personal agents must do more than retrieve facts or imitate style: they must learn from external material without falsely attributing its claims, experiences, or values to the user, and they must express different authorized facets of one person across social contexts. We present MindClone, an epistemic-authorization architecture for generating responses that a user recognizes, is willing to say, and can honestly defend. The architecture represents every proposition with semantic ownership, epistemic status, authorization scope, provenance, temporal validity, and contextual scope. Three mechanisms define its contribution. First, Endorsement-Gated Cognitive Assimilation allows external claims to support reasoning immediately after comprehension but requires user deliberation, endorsement, or application before a separate user-owned viewpoint can be created. Second, the Ownership Non-Escalation Constraint prevents compression, inference, and generation from converting external or third-party evidence into personal experience. Third, a Bounded Autobiographical Override gives an exact resume or other user-authorized scene artifact local precedence without writing that temporary identity back to longitudinal memory. A deferred inquiry queue closes the learning loop by surfacing unresolved conflicts when the user next initiates dialogue. We implement the architecture as a local SQLite-backed modular monolith with immutable sources, typed claims, authorization events, frozen scene snapshots, separated answer plans, and post-generation audits. Twelve deterministic tests verify state transitions, legacy migration, stale-derivation cleanup, ownership preservation, scene non-write-back, evidence-channel separation, and unsupported numeric-claim detection in Chinese and English; these are feasibility results rather than evidence of personal fidelity. We preregister a longitudinal target-user study and a multi-user replication whose joint endpoint combines self-likeness, willingness-to-say, scene appropriateness, follow-up consistency, unsupported autobiography, and cross-scene identity leakage. MindClone reframes personalization as controlled representational authority rather than memory volume.

**Keywords:** epistemic authorization; longitudinal personalization; autobiographical grounding; knowledge assimilation; digital self; scene-conditioned generation

## 1. Introduction

Large language models can retrieve a user's history, infer preferences, and reproduce recurrent lexical patterns. These capabilities do not by themselves solve the stronger problem of answering *as that person*. A useful personal agent must know at least five different things: what information it has encountered, who originally asserted or experienced it, whether the user currently endorses it, which facts are authorized in the present scene, and how the user would naturally express the resulting judgment. Flattening these distinctions into a vector store or persona prompt creates a characteristic failure: an agent becomes more knowledgeable while becoming less faithful to the person it represents.

This failure is especially visible after external learning. Suppose an agent transcribes a short video in which a speaker describes human-resource management and recounts leading a large recruiting program. The framework may immediately improve the agent's reasoning. The speaker's history, however, is not the user's history; the framework is not automatically the user's position; and stylistically rewriting either in the first person does not make the attribution valid. We call this family of failures **representational overreach**: the system uses a proposition with stronger authority than its provenance and user authorization permit.

Context creates a second difficulty. Human self-presentation is neither globally static nor arbitrarily role-played. A person can emphasize different real or explicitly authorized histories to different audiences. In a job interview, the exact resume submitted for that position may legitimately govern the professional identity presented in the room. Yet a sales resume used for one application should not permanently overwrite a longitudinal profile that also contains software-engineering conversations. The system therefore needs local identity precedence with a hard non-write-back boundary.

MindClone addresses these problems through a stateful architecture centered on epistemic authorization. Its product objective is not literal mimicry. It is a **professional self**: an agent may express the user's reasoning more clearly and professionally than the user's first draft, but should preserve the user's current values, recognizable discourse patterns, and authorized autobiography. Interviewing is used as the first high-pressure validation environment because it simultaneously tests knowledge, identity, evidence, audience adaptation, and follow-up consistency. The intended architecture remains general across workplace decisions, public expression, learning reflection, and interpersonal communication.

### 1.1 Research gap

Prior work provides strong components but not the required boundary model. MemoryBank, MemGPT, Mem0, reflective memory management, PersonaTree, and temporal knowledge graphs address long-term storage, update, reflection, and retrieval [1-6]. LoCoMo, LongMemEval, CloneMem, KnowMe-Bench, and LoCoMo-Plus expand evaluation from factual recall toward temporal, autobiographical, and principle-level understanding [7-11]. AI PERSONA, PersonaMem, PersonaAgent, PersonaTwin, BehaviorChain, and large-scale generative-agent simulations study evolving personas or digital twins [12-17]. Active preference inference, STaR-GATE, CPER, and VitaBench 2.0 establish that asking can outperform guessing [18-21]. TwinVoice, ExPerT, PPlug, and author-style studies evaluate personalized expression [22-25].

These lines of work leave a narrower but consequential gap. Provenance typically indicates where information came from, but does not determine the authority with which a personal agent may represent it. Dynamic persona operations decide whether a memory should be added, updated, or deleted, but do not necessarily distinguish “the system understands this” from “the user authorizes this as my view.” Contextual role prompting changes behavior, but does not guarantee that a temporary autobiographical override is locally scoped and unable to pollute longitudinal identity. Recent work on memory provenance laundering directly demonstrates the risk that external observations can be transformed into apparent user history during memory processing [26].

### 1.2 Contributions

This manuscript makes four claims, each designed to be independently falsifiable.

1. **Endorsement-Gated Cognitive Assimilation (EGCA).** External material enters a reasoning-authorized understanding layer. Internalization is a provenance-preserving derivation that creates a distinct user-owned viewpoint only after deliberation, endorsement, or evidenced application.
2. **Ownership Non-Escalation Constraint (ONEC).** No operation may convert external or third-party ownership into personal-experience authority. This constraint applies across extraction, merging, retrieval, planning, and rendering.
3. **Bounded Autobiographical Override (BAO).** A user-authorized scene artifact can locally override autobiographical selection while being technically prohibited from writing back to the longitudinal cognitive state.
4. **Joint fidelity-safety evaluation.** A personal agent passes only when it is recognizably the user *and* scene-appropriate, follow-up-consistent, free of unsupported autobiography, and free of cross-scene identity leakage.

Deferred Deliberative Internalization (DDI) operationalizes the interaction loop around EGCA. Background learning may create questions, but unresolved material cannot silently acquire stronger personal authority.

### 1.3 Research questions and hypotheses

**RQ1.** Does separating comprehension from endorsement reduce false personal attribution without reducing the usefulness of learned knowledge?

**RQ2.** Does ONEC reduce unsupported autobiographical claims under adversarial third-party examples and memory compression?

**RQ3.** Does BAO improve scene-specific identity fit while preventing identity leakage after the scene ends?

**RQ4.** Does separating answer planning from style rendering improve self-likeness and willingness-to-say without weakening evidence fidelity?

**RQ5.** Does deferred inquiry produce more confirmed, stable user viewpoints per interruption than immediate questioning or passive learning?

The confirmatory hypotheses are: H1, EGCA will lower false-view attribution relative to flat and dynamic-memory baselines while maintaining non-inferior answer usefulness; H2, ONEC will reduce unsupported autobiography under adversarial prompts; H3, BAO will improve scene appropriateness relative to global profiles and reduce post-scene leakage relative to globally applied resume conditioning; H4, the full system will outperform the strongest memory baseline on the joint fidelity-safety endpoint; and H5, DDI will improve confirmed viewpoints per user interruption.

## 2. Materials and Methods

### 2.1 Design objective

Let a generated response be acceptable only when it satisfies two simultaneous conditions. **Fidelity** requires that the user recognizes the discourse and judgment as their own and would willingly utter it. **Authority safety** requires that every first-person fact, experience, and position is licensed by the active scene or longitudinal cognition. Professional clarity may improve; ownership may not drift.

The architecture is local-first and model-agnostic. Structured state, rather than model parameters, is the source of truth because the user must be able to revise a belief, delete active cognition while preserving raw history, and exit a temporary role without retraining a model.

### 2.2 Formal cognitive state

At time *t*, the longitudinal state is

`M_t = (S, E, C, L, A, Q, H)`,

where `S` is the source set; `E` is immutable evidence; `C` is the claim set; `L` contains typed links among claims and evidence; `A` is the authorization-event log; `Q` is the deferred inquiry queue; and `H` is the original conversation history.

Each claim is a tuple

`c = <p, k, o, z, a, gamma, tau, rho>`,

where `p` is an atomic proposition; `k` is claim kind; `o` is semantic owner; `z` is epistemic status; `a` is authorization scope; `gamma` is contextual scope; `tau` is temporal validity; and `rho` is provenance linking the claim to source evidence and derivations.

Owner `o` is one of `user`, `external`, `third_party`, or `inferred`. Status `z` is one of `observed`, `understood`, `contested`, `endorsed`, `superseded`, or `rejected`. Authorization `a` is one of `none`, `reasoning_use`, `personal_view`, `personal_experience`, or `scene_fact`.

Status and authorization are intentionally orthogonal. `understood` describes the system's epistemic relation to a proposition; `reasoning_use` permits use as knowledge. `endorsed` describes user acceptance; `personal_view` permits representation as a current user viewpoint. Ownership describes whose assertion or experience the evidence supports and cannot be overwritten by fluency or repeated retrieval.

### 2.3 Source ingestion and evidence construction

Sources include user conversations, ChatGPT exports, notes, exact resumes, job descriptions, papers, articles, podcasts, and short-video speech transcripts. Each source stores an identifier, content checksum, source type, URI, actor, acquisition metadata, creation time, and extraction time. Evidence units preserve the source identifier, text, speaker, semantic owner, ordinal, and optional offsets.

The current short-video path accepts user-supplied Douyin share text, resolves downloadable media through TiKHub, extracts temporary audio with `ffmpeg`, and transcribes speech locally with `whisper.cpp`. Temporary video and audio are deleted after transcription. Visual frames, OCR, gestures, faces, and scene content are excluded from this version. The transcript remains an external source even when the user selected it for learning.

Structured extraction produces atomic claims, owner labels, claim kind, uncertainty, tags, and supporting evidence. Personal sources begin at `observed/none`; external knowledge begins at `understood/reasoning_use`; attributed stories begin with `third_party` ownership. Extraction quality cannot grant personal authority.

### 2.4 Epistemic transitions

Valid transitions are explicit and append an authorization event. Observed claims may become understood, contested, endorsed, or rejected. Understood claims may become contested or rejected; external claims cannot be directly relabeled as user views. Endorsed user claims may become contested, superseded, or rejected. Superseded and rejected cognition is terminal in the active store, preventing accidental resurrection through a generic update operation.

When a new user expression conflicts with an old endorsed view, generation may provisionally prefer the newer evidence, but the system must request confirmation. If the user states that the old view is no longer held, the old active claim is superseded or rejected. The original source conversation remains in `H`. A source-level tombstone preventing re-extraction is specified for the next implementation increment and is included in the human evaluation protocol.

### 2.5 Endorsement-Gated Cognitive Assimilation

Let `c_e` be an external claim with `z=understood` and `a=reasoning_use`. The internalization operation is not a mutation of `c_e`. It is a derivation:

`EGCA(c_e, d_u) -> (c_e, c_u, l_internalized_as)`,

where `d_u` is user deliberation evidence, `c_u` is a new user-owned viewpoint with `z=endorsed` and `a=personal_view`, and the typed link retains its relationship to `c_e`. The proposition in `c_u` may be a qualified interpretation rather than a copy of the source.

Version 1 requires an explicit user formulation and reason. The full protocol admits four sufficient signals: direct endorsement, repeated endorsement across separated sessions, application to a user-owned experience, or user confirmation of a derived interpretation. Automatic inference can propose but cannot complete the transition.

### 2.6 Ownership Non-Escalation Constraint

Define the authority ordering for autobiographical use as `none < reasoning_use < personal_view < personal_experience`. ONEC does not prohibit all upward authorization; it prohibits an ownership-changing escalation:

`o(c) != user => a(c) != personal_experience`.

It also prohibits direct external-to-personal-view mutation:

`o(c)=external or third_party => mutate(c, personal_view) is invalid`.

A separate derived `user` claim is required for personal-view authority, and only evidence whose semantic owner is `user` can authorize personal experience. The constraint is evaluated at state transition, scene compilation, answer planning, and post-generation audit. It specifically targets provenance laundering [26], third-party anecdote appropriation, and generated metrics absent from authorized evidence.

### 2.7 Bounded Autobiographical Override

A scene `b_s` is a frozen state object:

`b_s = <type, audience, goal, artifacts, precedence, prohibitions, expiry, writeBack=false>`.

For an interview, `artifacts` contains the job description and the exact submitted resume. The scene view is compiled from these artifacts plus currently authorized cognition. Its evidence precedence is: scene resume, compatible personal experience, personal view, understood knowledge, and third-party example. A lower layer may enrich reasoning but cannot contradict or impersonate a higher layer.

BAO differs from generic role prompting in three respects. It is tied to user-supplied autobiographical evidence, it has an explicit validity boundary, and the persistence layer rejects write-back. Consequently, a resume describing sales work can govern a sales interview without establishing “the user is globally a salesperson” after the scene ends.

### 2.8 Deferred deliberative internalization

External learning and contradiction detection may create inquiry items with a linked claim, question, reason, priority, state, and resolution time. Priority is a function of active-goal relevance, contradiction severity, expected information gain, source quality, and interruption cost. The scheduler does not continuously push questions. When the user next initiates a conversation, MindClone first addresses the user's request and may then surface at most a small number of unresolved questions.

This mechanism supports an actively curious agent without allowing autonomous collection to redefine the user. The current implementation persists and retrieves queued inquiries. Automatic prioritization, muting policy, and dialogue-derived resolution are evaluated as future increments.

### 2.9 Scene-conditioned answer construction

Answer construction separates selection from rendering.

1. Compile or load the frozen scene.
2. Parse question intent and retrieve relevant claims.
3. Select reasoning claims and personal claims into different ID lists.
4. Construct an answer plan with a thesis instruction, experience policy, and follow-up constraints.
5. Render the plan with a local language model and user expression samples.
6. Audit the completed answer against the scene and selected evidence.
7. Persist the question, plan, answer, audit, and scene identifier.

The rendering prompt requires a direct spoken answer rather than generic coaching. It may combine external frameworks with the resume and authorized personal judgments, but it may not convert a source author's case into “I did.” The current deterministic audit extracts numeric assertions in both Chinese and English, verifies them against the resume, job description, and selected claims, checks availability of a first-person evidence channel, and verifies `writeBack=false`. Clause-level natural-language inference and citation coverage are reserved for the next implementation.

### 2.10 Expression policy

Style is modeled as evidence about discourse rather than a bag of memorable phrases. Candidate features include conclusion-first tendency, sentence length, lexical register, directness, example density, hedging, emotional intensity, disagreement strategy, and preferred rhetorical structure. Existing `Recents` conversations provide the initial corpus; simulated interviews collect scene-matched speech.

Style rendering occurs after evidence selection so that surface similarity cannot authorize content. The target is neither verbatim imitation nor generic assistant polish. It is a clearer and more professional version of the user's recognizable expression. The system is permitted to disagree with the user when evidence strongly conflicts, while avoiding reflexive sycophancy and preserving uncertainty about inferred values [27,28].

### 2.11 Reference implementation

The first implementation is a local modular monolith. A React/Electron client manages daily dialogue, cognition review, scene preparation, formal questioning, cancellation, and local-model streaming. An Express service owns domain transitions and HTTP contracts. Node's built-in SQLite driver stores state in WAL mode with foreign-key constraints and full-text claim indexing.

The schema contains `sources`, `evidence_units`, `claims`, `claim_evidence`, `claim_relations`, `authorization_events`, `scenes`, `inquiry_items`, `answer_runs`, `sessions`, and `messages`. An idempotent migration imports the prototype JSON store once while retaining the raw file. Legacy learning cards migrate to `external/understood/reasoning_use`, closing the central ownership regression that motivated the refactor.

The formal read path contains no cloud fallback. DeepSeek may support daily conversation and asynchronous write-path extraction. Interview generation uses the configured local OpenAI-compatible model so a cloud call cannot alter latency or disclosure assumptions during the scene.

### 2.12 Experimental design

The evaluation has two tiers. Tier 1 is a 6-8 week longitudinal target-user study because the primary product claim concerns one evolving person. Tier 2 is a repeated-measures multi-user replication; the final sample size will be determined by simulation-based power analysis using pilot effect and variance estimates, with an initial operational range of 24-40 participants.

Participants contribute longitudinal conversations, a structured values and experience interview, style samples, external learning materials, and at least two deliberately different scenes. Interview scenes use the exact submitted resume or a controlled scene-specific profile. Held-out questions include direct, behavioral, adversarial, and multi-turn follow-up forms. Temporal splits prevent future answers from leaking into initial personalization.

### 2.13 Baselines and ablations

The planned conditions are: B0, unpersonalized base model; B1, full conversation context; B2, vector retrieval over flat chunks; B3, dynamic flat memory with add/update/delete operations; B4, temporal graph memory without epistemic authorization; and B5, full MindClone.

Ablations remove EGCA, ONEC, BAO, DDI, expression rendering, or answer-plan separation. A deliberate negative control applies the interview resume globally after the scene. Adversarial probes include third-party achievements phrased near user history, unsupported numbers, conflicting resumes and conversations, superseded viewpoints, socially accommodating utterances, erroneous external sources, and follow-up questions that pressure the model to embellish.

### 2.14 Outcome measures

The joint primary endpoint requires all of the following:

- blind self-likeness compared with baselines;
- willingness to say the answer with no or minor edits;
- scene appropriateness for the intended audience and goal;
- consistency across adversarial follow-up turns;
- unsupported autobiographical claim rate below the safety threshold;
- cross-scene identity leakage below the safety threshold.

Secondary outcomes are professionalism, usefulness, naturalness, perceived AI-like style, edit distance after user revision, time to acceptable answer, external claim attribution coverage, obsolete-view usage, third-party ownership confusion, and confirmed perspectives per ten user interruptions.

The preregistered deployment targets are: median self-likeness and willingness-to-say of at least 5.5 on a 7-point scale; perceived AI-like style no greater than 2.5; at least a 15 percentage-point blind self-recognition improvement over B3; unsupported autobiographical claims below 2%; cross-scene identity leakage below 2%; and evidence coverage above 95% for externally grounded major claims. These thresholds are targets, not current results.

### 2.15 Procedure and blinding

For each evaluation question, condition labels are hidden and response order is randomized. The target user rates all outputs; independent evaluators rate professionalism, scene fit, evidence support, and attribution without seeing the system condition. Follow-up sets are scored as connected episodes rather than independent answers. A second annotator resolves safety disagreements, and inter-rater agreement is reported.

After each longitudinal block, participants may correct claims, supersede views, and discuss queued inquiries. Evaluation snapshots are frozen before scoring so feedback cannot retroactively alter the compared outputs. Cross-scene probes are administered after scene closure to test whether temporary identity remains active.

### 2.16 Statistical analysis

Blind pairwise preferences will be analyzed with a Bayesian hierarchical Bradley-Terry model containing participant, question, scene, and time effects. Seven-point ratings will use cumulative-link mixed models. Safety events will use beta-binomial models with uncertainty intervals. The confirmatory comparison is B5 versus B3 and B4 on the joint endpoint; ablations test the marginal contribution of each mechanism. Non-inferiority for usefulness in H1 will use a margin fixed before pilot labels are unblinded. Holm correction will control the confirmatory family, and effect sizes with 95% intervals will accompany all significance tests.

### 2.17 Reproducibility, privacy, and ethics

Prompts, schemas, model identifiers, source checksums, authorization events, scene snapshots, plans, and audit outputs are versioned. Deterministic tests run without external model calls. Human-study materials will require informed consent, a deletion mechanism, and explicit governance for whether autobiographical data may be shared. Although the current product owner permits cloud synchronization, provider boundaries remain explicit so local-only and cloud-enabled configurations can be compared.

Autonomous learning jobs must follow platform authorization, copyright, rate limits, and user-configured source boundaries. The ability to discover material is not authority to publish, impersonate, transact, or bypass access controls.

## 3. Results

### 3.1 Implementation completeness

Version 1 implements the minimum architecture required to test the three central state boundaries. External claims can be stored as understood reasoning knowledge. The internalization endpoint creates a separate user viewpoint, retains the original owner and status, records a typed relation, and logs the authorization event. Scene compilation persists a frozen snapshot with hard-coded non-write-back. Answer planning stores knowledge and personal claim identifiers in separate channels. Completed answers are retained with their audit trace.

The SQLite migration retains sources, candidate claims, sessions, and messages from the JSON prototype. It maps approved external learning to reasoning authority rather than personal authority and records a migration marker so subsequent starts are idempotent.

### 3.2 Deterministic verification

The implementation test suite contains 12 deterministic tests, all of which passed on 13 August 2026 under Node.js 22.23.1. The tests cover external knowledge authorization, personal-experience authority, invalid terminal-state resurrection, legacy learning ownership, stale claim/search/inquiry cleanup during re-extraction, scene non-write-back, separate answer-plan channels, unsupported numeric claims, supported resume metrics, idempotent legacy migration, and an HTTP-level internalization/scene/audit flow.

The HTTP test uses an external HR-management claim, internalizes a user formulation, and verifies that the source remains `external/understood` while the derivative becomes `user/endorsed/personal_view`. It then compiles an HR interview from a submitted resume and verifies `writeBack=false`. Finally, the Chinese answer “I led an HR team of 120 and achieved 200% growth” is rejected because neither number exists in the authorized scene evidence.

TypeScript checking and the production Vite build also complete successfully. These results establish executable consistency between the proposed invariants and the first implementation. They do not establish human likeness, scene quality, long-term learning benefit, or journal-level efficacy.

### 3.3 Unimplemented protocol components

The present system does not yet provide semantic clause-level citations, embedding or graph reranking, automatic contradiction confirmation, tombstone-based re-extraction suppression, empirically learned expression features, inquiry scheduling by information gain, or multi-user experimentation. Numeric auditing is a narrow guard and cannot detect every fabricated qualitative experience. Accordingly, no claim is made that the current prototype already “became the user.”

### 3.4 Preregistered reporting rule

The human Results section will report every baseline and ablation, including null and negative findings. It will separate target-user outcomes from population-level replication, report all safety violations rather than only averages, and publish the count and disposition of excluded questions. The manuscript will not use the term “Q1-ready” as an empirical result until the confirmatory study is completed.

## 4. Discussion

### 4.1 Principal interpretation

MindClone's central position is that personal-agent memory is an authorization problem as much as a retrieval problem. An agent may know a proposition, understand its argument, and use it to reason while lacking permission to present it as the user's belief or experience. This separation allows learning to be immediate without making identity revision automatic.

The same model clarifies context-sensitive self-presentation. BAO does not pretend that a person has one context-free biography, nor does it allow arbitrary role-play to corrupt longitudinal identity. The scene artifact grants local representational authority and then expires. This directly matches the product requirement: in an HR interview the agent should answer from the HR resume and HR knowledge; in another scene it should select a different authorized facet without rewriting who the user is everywhere else.

### 4.2 Relationship to prior work

The contribution is intentionally narrower than “long-term memory,” “digital clone,” “active personalization,” or “style imitation,” all of which have substantial prior art. Mem0 and PersonaTree motivate explicit update operations [3,5]; Zep motivates temporal and provenance-aware graphs [4]; KnowMe-Bench and LoCoMo-Plus motivate autobiographical and principle-level evaluation [10,11]; PersonaAgent links dynamic persona to action [14]; CPER and VitaBench 2.0 motivate question asking [20,21]; and TwinVoice and ExPerT motivate multi-dimensional expression evaluation [22,23].

MindClone instead specifies how these capabilities are allowed to change representational authority. EGCA turns internalization into a traceable derivation rather than a memory relabel. ONEC makes autobiographical ownership an invariant rather than a prompt preference. BAO makes contextual identity a persisted, bounded state object rather than an unscoped persona instruction. The combined evaluation penalizes systems that sound highly similar while fabricating the user's life.

### 4.3 Expected scientific value

If the confirmatory results support the hypotheses, the work would contribute a state-transition account of personal knowledge assimilation, an implementable safety constraint for autobiographical agents, and a method for measuring the benefit and leakage of scene-local identity. These mechanisms are relevant beyond interviews wherever an agent combines outside knowledge with first-person representation, including public posting, professional communication, education, and decision support.

If EGCA does not improve user endorsement, or if simple metadata filters match ONEC and BAO, the broader architecture should be rejected in favor of a smaller software design. This falsifiability is important: Q1 publication cannot be justified by the product aspiration alone.

### 4.4 Limitations

First, the deterministic implementation results test invariants but not semantic fidelity. A model can avoid unsupported numbers while fabricating a plausible qualitative episode. Second, user endorsement is not equivalent to truth; users may endorse misinformation, strategic self-presentation, or unstable positions. Source quality and evidence validity therefore remain separate concerns. Third, an N-of-1 longitudinal study has unusually high ecological validity for the target product but cannot establish population generality. Fourth, social flexibility is difficult to distinguish from deference or inconsistency, and value inference should remain probabilistic. Fifth, style similarity can reward superficial verbal quirks and may conflict with professionalism. Sixth, exact resumes can themselves contain inaccurate claims; BAO controls system authority, not external verification of the artifact.

The current use of Node's experimental SQLite interface also creates an engineering portability risk, although the relational contract is not tied to that driver. External platform ingestion depends on service availability and must be maintained independently from cognition logic.

### 4.5 Next implementation and study steps

The next build should add clause-level provenance, FTS plus embedding retrieval, typed contradiction relations, user-confirmed supersession with tombstones, an inquiry priority policy, and expression features learned from recent conversations and simulated interviews. A frozen evaluation harness should then generate baseline and ablation outputs from identical scene snapshots. Only after the target-user interview gate passes should the study expand to other scenes and a powered multi-user replication.

## 5. Conclusion

MindClone proposes an epistemic-authorization architecture for a personal agent that learns broadly while representing narrowly and honestly. External knowledge may improve reasoning immediately, but user identity changes only through a traceable user-owned derivation. Third-party evidence cannot become personal experience. Scene-specific autobiographical artifacts can govern local answers but cannot write back to the longitudinal self. These boundaries make the product objective measurable: the answer should sound like the user, fit the current scene, survive follow-up, and remain something the user can truthfully claim.

The first implementation demonstrates that the core constraints can be encoded, persisted, migrated, and tested. Whether they create a meaningfully better personal agent remains an empirical question reserved for the preregistered longitudinal and multi-user studies. The paper and the software therefore share the same acceptance target rather than treating publication as a narrative layered on top of an unrelated product.

## Acknowledgments

No external funding was received for this first implementation manuscript. The authors acknowledge the maintainers and research communities behind Mem0, Graphiti/Zep, HippoRAG, Microsoft GraphRAG, whisper.cpp, and the broader personalized-agent literature.

## Conflict of Interest

The authors declare no commercial or financial conflict of interest related to this manuscript.

## Data and Code Availability

The reference implementation, architecture documents, deterministic tests, and literature corpus are maintained in the MindClone repository. Longitudinal conversations and scene artifacts contain personal data and will not be publicly released without a separate consent and anonymization decision. Evaluation schemas, synthetic adversarial probes, and aggregate results are intended for release with the empirical manuscript.

## References

1. Zhong W, Guo L, Gao Q, et al. MemoryBank: Enhancing Large Language Models with Long-Term Memory. Proceedings of AAAI. 2024.
2. Packer C, Wooders S, Lin K, et al. MemGPT: Towards LLMs as Operating Systems. arXiv:2310.08560. 2023.
3. Chhikara P, Khant D, Aryan S, Singh T, Yadav D. Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory. arXiv:2504.19413. 2025.
4. Rasmussen P, Paliychuk P, Beauvais T, Ryan J, Chalef D. Zep: A Temporal Knowledge Graph Architecture for Agent Memory. arXiv:2501.13956. 2025.
5. Zhao J, Chen D, Fan Z, et al. Inside Out: Evolving User-Centric Core Memory Trees for Long-Term Personalized Dialogue Systems. Proceedings of ACL. 2026.
6. Tan Z, Yan J, Hsu I-H, et al. In Prospect and Retrospect: Reflective Memory Management for Long-Term Personalized Dialogue Agents. Proceedings of ACL. 2025.
7. Maharana A, Lee D-H, Tulyakov S, Bansal M, Barbieri F, Fang Y. Evaluating Very Long-Term Conversational Memory of LLM Agents. Proceedings of ACL. 2024.
8. Wu D, Wang H, Yu W, Zhang Y, Chang K-W, Yu D. LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory. arXiv:2410.10813. 2024.
9. Hu S, Zhang Z, Wei Y, et al. CloneMem: Benchmarking Long-Term Memory for AI Clones. Proceedings of ACL. 2026.
10. Wu T, Chen Z, Weng Z, et al. KnowMe-Bench: Benchmarking Person Understanding for Lifelong Digital Companions. Proceedings of ACL. 2026.
11. Li Y, Guo W, Zhang L, et al. LoCoMo-Plus: Beyond-Factual Cognitive Memory Evaluation Framework for LLM Agents. Proceedings of ACL. 2026.
12. Wang T, Tao M, Fang R, et al. AI PERSONA: Towards Life-long Personalization of LLMs. arXiv:2412.13103. 2024.
13. Jiang B, Yuan Y, Shen M, et al. PersonaMem-v2: Towards Personalized Intelligence via Learning Implicit User Personas and Agentic Memory. arXiv:2512.06688. 2025.
14. Zhang W, Zhang X, Zhang C, et al. PersonaAgent: Bridging Memory and Action for Personalized LLM Agents. Findings of ACL. 2026.
15. Chen S, Lalor JP, Yang Y, Abbasi A. PersonaTwin: A Multi-Tier Prompt Conditioning Framework for Generating and Evaluating Personalized Digital Twins. Proceedings of GEM. 2025.
16. Li R, Xia H, Yuan X, et al. How Far Are LLMs from Being Our Digital Twins? A Benchmark for Persona-Based Behavior Chain Simulation. Findings of ACL. 2025.
17. Park JS, Zou CA, Shaw A, et al. Generative Agent Simulations of 1,000 People. arXiv:2411.10109. 2024.
18. Piriyakulkij WT, Kuleshov V, Ellis K. Active Preference Inference Using Language Models and Probabilistic Reasoning. arXiv:2312.12009. 2023.
19. Andukuri C, Fränken J-P, Gerstenberg T, Goodman ND. STaR-GATE: Teaching Language Models to Ask Clarifying Questions. arXiv:2403.19154. 2024.
20. Baskar S, Verelakar T, Parthasarathy S, Gaur M. From Guessing to Asking: Resolving the Persona Knowledge Gap in Multi-Turn Conversations. Proceedings of NAACL Student Research Workshop. 2025.
21. Chen Y, Zhang Y, Cai Z, et al. VitaBench 2.0: Evaluating Personalized and Proactive Agents in Long-Term User Interactions. arXiv:2605.27141. 2026.
22. Du B, Guo M, He S, et al. TwinVoice: A Multi-dimensional Benchmark Towards Digital Twins via LLM Persona Simulation. Findings of ACL. 2026.
23. Salemi A, Killingback J, Zamani H. ExPerT: Effective and Explainable Evaluation of Personalized Long-Form Text Generation. Findings of ACL. 2025.
24. Liu J, Zhu Y, Wang S, et al. LLMs + Persona-Plug = Personalized LLMs. Proceedings of ACL. 2025.
25. Wang Z, Tripto NI, Park S, Li Z, Zhou J. Catch Me If You Can? Not Yet: LLMs Still Struggle to Imitate the Implicit Writing Styles of Everyday Authors. Findings of EMNLP. 2025.
26. Xu J, Xiao Y, Shao W, Liu H, Li X. Memory Provenance Laundering in LLM Agents: A Non-Amplification Firewall for Persistent Memory. arXiv:2607.29167. 2026.
27. Koo S, Kim J, Lim H. I Know, but I Don't Know! How Persona Conflict Undermines Instruction Adherence in Large Language Models. Findings of EACL. 2026.
28. Guan J, Wu J, Li J-N, Cheng C, Wu W. A Survey on Personalized Alignment: The Missing Piece for Large Language Models in Real-World Applications. arXiv:2503.17003. 2025.
29. Sumers TR, Yao S, Narasimhan K, Griffiths TL. Cognitive Architectures for Language Agents. Transactions on Machine Learning Research. 2024.
30. Dziri N, Kamalloo E, Milton S, Zaiane O, Yu M, Ponti EM, Reddy S. Evaluating Attribution in Dialogue Systems: The BEGIN Benchmark. Transactions of the Association for Computational Linguistics. 2022;10:1066-1083.
31. Gutiérrez BJ, Shu Y, Gu Y, Yasunaga M, Su Y. HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models. Advances in Neural Information Processing Systems. 2024.
32. Edge D, Trinh H, Cheng N, et al. From Local to Global: A Graph RAG Approach to Query-Focused Summarization. arXiv:2404.16130. 2024.
33. Lewis P, Perez E, Piktus A, et al. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. Advances in Neural Information Processing Systems. 2020;33:9459-9474.
34. Liu NF, Lin K, Hewitt J, et al. Lost in the Middle: How Language Models Use Long Contexts. Transactions of the Association for Computational Linguistics. 2024;12:157-173.
35. Wang X, Wu C, Yuan Y, et al. Two Tales of Persona in LLMs: A Survey of Role-Playing and Personalization. Findings of EMNLP. 2024.

## 中文审阅说明（非投稿正文）

这版论文已经和软件验收目标强绑定。论文不再声称“长期记忆”“数字分身”或“主动提问”本身是创新，而是研究个人智能体的认识论授权边界：知道什么、知识属于谁、用户是否认同、当前场景允许代表哪个版本的用户，以及临时身份是否污染长期自我。

目前可以证明的是架构约束已经写进代码并通过 12 项确定性测试；不能证明的是系统已经足够像本人。真正决定能否投稿一区的不是论文措辞，而是后续实验是否在强基线和消融下同时提升本人相似度、场景适配、愿意说与追问一致性，并把虚构经历和跨场景污染压到预注册阈值以下。
