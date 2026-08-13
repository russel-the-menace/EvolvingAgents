# MindClone: A Provenance-Aware Continual Cognitive Architecture for Learning, Value Alignment, and Contextual Self-Expression

**Manuscript type:** System architecture and preregistered longitudinal evaluation protocol  
**Version:** 0.1 (design manuscript; empirical results pending implementation)  
**Date:** 13 August 2026

## Abstract

Personalized language agents typically optimize either factual memory or stylistic imitation, but rarely model how a person learns external knowledge, negotiates that knowledge through dialogue, revises values over time, and expresses a context-appropriate version of the self. We propose MindClone, a provenance-aware continual cognitive architecture whose objective is not to reproduce a user's raw wording, but to generate responses that a user would willingly endorse as a clearer and more professional expression of themselves. The architecture separates five representational layers: external understanding, personal evidence, value state, contextual role, and expression policy. Imported material is automatically converted into source-grounded claims at an “understood” level; a claim becomes “internalized” only after user discussion, explicit endorsement, or evidenced application. Personal beliefs are modeled as temporally versioned and context-sensitive rather than as static preferences. At inference time, a scene contract, such as the exact resume submitted for an interview, may override the default autobiographical view without rewriting long-term memory. A deferred inquiry mechanism allows background learning processes to accumulate contradictions and high-information questions that are surfaced when the user next initiates conversation. We preregister a longitudinal, single-user-first evaluation centered on interview performance and later extended to cross-scenario transfer. Primary outcomes are blind self-recognition and endorsement; safety gates measure autobiographical attribution errors, source confusion, contradiction handling, and unsupported experience claims. Comparisons against long-context prompting, vector retrieval, flat memory, and graph-memory baselines, together with component ablations, test whether provenance, internalization, temporal belief revision, contextual role contracts, and style rendering each contribute independently. This work defines a falsifiable blueprint for cognitive personalization beyond static persona prompting.

**Keywords:** continual personalization; cognitive architecture; provenance-aware memory; value modeling; contextual identity; style alignment

## 1. Introduction

Large language models can imitate linguistic patterns, retrieve stored facts, and adapt to local conversational context. These capabilities are insufficient for the stronger objective of answering *as a learned person*. A learned person does not merely repeat external material: they relate new claims to prior experience, accept or reject them through reflection, change their mind over time, and modulate self-presentation across social contexts. The same individual may speak differently in private conversation, public discourse, and a job interview without thereby possessing three unrelated value systems.

Existing memory systems expose four persistent limitations. First, flat memory records conflate external knowledge, third-party examples, personal experience, and personal belief. Second, append-only retrieval allows obsolete beliefs or roles to compete with current ones. Third, style imitation is commonly applied as a final prompt instruction without separating stable discourse habits from task-specific professionalism. Fourth, evaluation often rewards factual recall while neglecting whether the user recognizes and endorses the generated answer as their own.

MindClone addresses these limitations by treating personalization as a continual, provenance-constrained learning process. It preserves immutable source evidence, derives revisable claims, distinguishes comprehension from internalization, models belief states over time and context, and constructs a scene-specific answer from knowledge, autobiographical evidence, values, and style. Interviewing is used as the first validation scenario because it jointly stresses factual grounding, role adaptation, professional expression, and rapid follow-up consistency. It is not the final product boundary.

### 1.1 Research gap

Hierarchical memory architectures manage limited context windows [1], personalized memory layers implement add-update-delete operations [2], temporal knowledge graphs preserve changing facts [3], and graph retrieval improves multi-hop access to external knowledge [4,5]. However, these systems do not jointly formalize the transition from externally understood knowledge to personally internalized belief, nor the controlled override of autobiographical identity by a user-authorized scene contract. They also rarely treat user endorsement and self-recognition as primary longitudinal outcomes.

### 1.2 Research questions

**RQ1.** Does separating understood knowledge from internalized perspective reduce false attribution while preserving answer usefulness?  
**RQ2.** Do temporal belief revision and explicit conflict confirmation improve value consistency compared with append-only memory?  
**RQ3.** Does a scene contract improve role-specific answer quality without corrupting long-term identity?  
**RQ4.** Does a learned expression policy increase blind self-recognition and reduce perceived “AI-like” language?  
**RQ5.** Does deferred active inquiry accelerate personalization more efficiently than passive conversation alone?

### 1.3 Hypotheses

H1: The full system will improve blind self-recognition by at least 15 percentage points over retrieval-only personalization.  
H2: Provenance and ownership constraints will keep autobiographical attribution error below 2% of scored claims.  
H3: Removing the internalization gate will increase false ownership of external viewpoints.  
H4: Removing the scene contract will reduce interview-role consistency, whereas making it globally authoritative will increase cross-scene identity errors.  
H5: Deferred inquiry will produce more confirmed perspectives per user interaction than immediate questioning after every import.  
H6: Style rendering will improve user endorsement independently of factual correctness.

## 2. Materials and Methods

### 2.1 Design principles

The architecture follows six constraints: (i) evidence is immutable; (ii) derived cognition is revisable; (iii) ownership is explicit; (iv) current beliefs supersede rather than silently coexist with obsolete beliefs; (v) context can alter presentation and role evidence without rewriting global identity; and (vi) every major answer claim must be traceable to knowledge, personal evidence, or an explicitly generated inference.

### 2.2 Cognitive state model

At time *t*, the system state is defined as:

**M(t) = {S, E, Kᵤ, Kᵢ, X, V, R, P, Q}**, where *S* denotes sources; *E*, evidence units; *Kᵤ*, understood claims; *Kᵢ*, internalized claims; *X*, personal experiences; *V*, temporally versioned values; *R*, scene contracts; *P*, expression-policy features; and *Q*, deferred inquiry items.

Knowledge is represented as a directed provenance graph. Every derived claim cites one or more evidence units. Ownership is one of `external`, `personal`, or `synthesized`. Epistemic status is one of `observed`, `understood`, `internalized`, `contested`, `superseded`, or `deleted`. A synthesized claim may become a personal perspective only after the internalization criteria in Section 2.5 are satisfied.

### 2.3 Source ingestion and evidence construction

Sources include conversations, resumes, job descriptions, notes, articles, papers, podcasts, and short-video transcripts. Media are transcribed before semantic ingestion; visual content is excluded from the current protocol. Each source stores platform, author or speaker, acquisition method, time, URI, checksum, and ownership. Text is segmented into evidence units using semantic boundaries with stable offsets and, where available, timestamps.

For each evidence unit, structured extraction produces atomic claims, concepts, typed relations, third-party examples, uncertainty, and candidate contradictions. Extraction is source-sensitive: a video speaker's history cannot create a personal experience record. Duplicate claims are merged by normalized meaning while preserving all supporting and contradicting evidence.

### 2.4 Continual external learning

Background learning is modeled as a permissioned scheduler that can execute saved searches or platform-specific collection jobs. Its output enters *Kᵤ* only. Selection priority is calculated from relevance to current goals, novelty relative to the existing graph, source diversity, and contradiction with current beliefs. The scheduler may discover material autonomously but cannot follow accounts, publish content, purchase access, or bypass platform restrictions without explicit authority.

### 2.5 Internalization through dialogue

An understood claim *k* becomes internalized when at least one of the following occurs: (i) explicit endorsement; (ii) repeated endorsement across separated sessions; (iii) successful application to a personal experience; or (iv) the user formulates a derivative interpretation and confirms it. The transition records supporting dialogue, confidence, context scope, and time.

The system is expected to challenge the user when high-confidence evidence conflicts with a current belief. It generates a question rather than silently overwriting the belief. New expression is provisionally preferred for generation, but the system requests confirmation. If the user explicitly rejects the former belief, its derived cognitive record is deleted from active cognition; the immutable source conversation remains unless separately deleted. A tombstone prevents automatic re-extraction of the rejected belief from that source.

### 2.6 Value representation and social flexibility

Values are not inferred directly from isolated utterances. Each value record contains proposition, polarity, confidence, stability, context scope, social-pressure likelihood, supporting events, contradicting events, and validity interval. A single accommodating response in a social context therefore contributes weaker evidence than deliberate reflection or repeated public expression.

The model separates: (a) core values, expected to generalize across contexts; (b) contextual positions, valid for a domain or audience; (c) social strategies, such as politeness or temporary accommodation; and (d) observed utterances, which are evidence but not automatically beliefs.

### 2.7 Scene contracts and dynamic identity

A scene contract is a user-authorized, time-bounded specification of the role being enacted. For an interview, it contains the job description, exact submitted resume, target competencies, prohibited claims, desired seniority, and answer constraints. Within that interview, the submitted resume has higher evidential priority than conflicting general conversation about occupational identity. This priority is local to the scene and cannot rewrite the longitudinal autobiographical store.

Evidence precedence is: **scene-authorized evidence > approved compatible personal evidence > internalized perspective > understood knowledge > third-party example**. A lower-precedence item may enrich reasoning but cannot contradict a higher-precedence identity constraint.

### 2.8 Deferred active inquiry

Background learning produces inquiry candidates when it detects a knowledge-value conflict, missing autobiographical evidence, uncertain ownership, or a high-impact topic lacking a personal stance. Candidates are ranked by expected information gain, relevance to active goals, urgency, and interaction cost. Questions are not pushed continuously. When the user next initiates a conversation, the system may surface a small batch after addressing the user's immediate request. The user can defer, dismiss, or permanently mute a topic.

### 2.9 Answer construction

Answer generation is a staged process rather than a single retrieval prompt:

1. Parse the scene contract and question intent.
2. Retrieve knowledge claims using lexical, semantic, temporal, and graph-neighborhood signals.
3. Retrieve compatible personal experiences and current values.
4. Construct an answer plan containing thesis, reasoning framework, personal evidence, limitations, and follow-up consistency constraints.
5. Validate ownership and provenance for every autobiographical clause.
6. Render the plan through the expression policy.
7. Run a final critic for contradiction, unsupported experience, and scene violations.

The expression policy models discourse features rather than memorized phrases: directness, conclusion-first tendency, sentence length, lexical register, example density, hedging, emotional intensity, disagreement style, and preferred rhetorical structures. The target is a more coherent and professional version of the user, not an imitation of generic assistant prose.

### 2.10 Data architecture

The reference implementation will use a local relational store with full-text search and typed relation tables. Core records are `sources`, `evidence_units`, `claims`, `claim_evidence`, `concepts`, `relations`, `experiences`, `values`, `scene_contracts`, `perspectives`, `inquiry_queue`, `expression_features`, `answer_plans`, and `feedback_events`. Embeddings and graph reranking are replaceable retrieval components rather than sources of truth.

### 2.11 Experimental design

The primary study is a longitudinal N-of-1 repeated-measures evaluation with blinded pairwise judgments. This is appropriate because the target construct is fidelity to one evolving individual. A secondary multi-user replication is planned after the protocol stabilizes.

#### Phase A: Initial acquisition

Existing recent conversations provide the initial style and value corpus. A structured intake interview and repeated simulated interviews collect spoken and written answers. The corpus is partitioned temporally to prevent future answers from leaking into baseline construction.

#### Phase B: Interview validation

The user provides a job description and the exact submitted resume. A standardized interviewer asks core, behavioral, adversarial, and follow-up questions. Answers are generated by each baseline and presented anonymously in randomized order. The user scores self-likeness, willingness to say the answer aloud, professionalism, naturalness, and perceived AI style.

#### Phase C: Longitudinal learning

New external materials are ingested over multiple weeks. Deferred questions are discussed during naturally initiated sessions. Evaluation repeats on held-out interview questions to measure learning and internalization without memorizing test answers.

#### Phase D: Cross-scenario transfer

Only after interview criteria are met, the same cognitive state is evaluated on workplace decisions, public opinion, writing, interpersonal replies, and learning reflection.

### 2.12 Baselines and ablations

Baselines are: B0, base model without personalization; B1, full conversation context; B2, vector retrieval over flat chunks; B3, flat extracted memory with style prompt; and B4, graph retrieval without internalization or scene contracts. The full system is B5.

Ablations remove one component at a time: provenance ownership, internalization gate, temporal belief revision, scene contract, deferred inquiry, graph expansion, personal evidence linking, and style rendering. A “scene-globalization” negative control incorrectly applies the interview resume to all contexts.

### 2.13 Outcome measures

The primary endpoint is **blind self-recognition rate**: the probability that the user selects the system answer as most representative of themselves among blinded alternatives. Co-primary endorsement is the proportion rated “I would say this with no or minor edits.”

Secondary outcomes include a 7-point self-likeness score; perceived AI-style score; professionalism; factual usefulness; follow-up consistency; edit distance after user revision; time to acceptable answer; and confirmed perspectives per ten user interactions.

Safety gates are autobiographical attribution error rate, third-party ownership confusion, obsolete-belief usage, unsupported experience claims, scene-contract violations, and citation coverage. Any condition exceeding 2% unsupported autobiographical claims fails deployment regardless of style score.

### 2.14 Statistical analysis

Pairwise preferences will be analyzed using a Bayesian hierarchical Bradley–Terry model with question type and session as varying effects. Ordinal ratings will use cumulative-link mixed models. Binary safety events will receive beta-binomial credible intervals. Longitudinal change will be modeled against interaction count rather than calendar time. Holm correction will control family-wise error for confirmatory ablations. Effect sizes and 95% intervals will be reported alongside *p* values. The preregistered success criterion is a posterior probability greater than 0.95 that B5 exceeds B3 by at least 0.15 in self-recognition, while meeting every safety gate.

### 2.15 Reproducibility and governance

All prompts, model versions, extraction schemas, scene contracts, retrieval traces, and answer-plan citations will be versioned. Randomization seeds and evaluation assignments will be stored. Cloud processing is permitted by default in the current deployment policy, but local and cloud providers must implement the same interfaces so privacy modes remain testable. Autonomous collection must comply with platform authorization, rate limits, copyright, and user-configured source boundaries.

## 3. Results

### 3.1 Current feasibility observations

This manuscript precedes the target implementation; therefore, no efficacy claims are made. The existing prototype has demonstrated three feasibility components only: local ingestion of conversation records, provenance-preserving storage of imported material, and an operational short-video pipeline that resolves a user-provided Douyin share link, extracts audio, and produces a local Whisper transcript. These observations establish implementation feasibility but do not test the hypotheses above.

### 3.2 Preregistered result reporting

The completed study will report corpus growth, understood-to-internalized transition rates, inquiry acceptance, retrieval provenance coverage, interview outcomes by question class, longitudinal style convergence, and all safety errors. Results will be reported for every baseline and ablation, including negative or null findings. No missing rating will be imputed as success.

### 3.3 Decision thresholds

Interview validation passes only if the full system satisfies all of the following on held-out questions: self-recognition improvement of at least 15 percentage points over flat memory; median self-likeness at least 5.5/7; median willingness-to-say at least 5.5/7; perceived AI style no greater than 2.5/7; unsupported autobiographical claim rate below 2%; scene-contract violation below 2%; and citation coverage above 95% for externally grounded claims.

## 4. Discussion

MindClone reframes personalization as continual cognitive alignment rather than persona prompting. Its central innovation is the explicit separation and later controlled recombination of external understanding, internalized perspective, autobiographical evidence, contextual role, and expression policy. This separation is necessary because style similarity can conceal factual misattribution, while factual memory alone cannot produce a response that the user experiences as their own.

The internalization gate operationalizes a distinction often left implicit in memory systems: exposure is not belief. Deferred inquiry further treats the user as an active participant in model formation rather than a passive data source. The scene contract addresses a different problem: legitimate contextual self-presentation. A submitted sales resume can govern a sales interview even when longitudinal conversations also contain a programming identity, without forcing the system to decide that one history is globally false.

The approach synthesizes, but does not duplicate, prior systems. MemGPT motivates memory tiers [1]. Mem0 contributes explicit memory operations [2]. Graphiti contributes temporal provenance [3]. HippoRAG contributes associative graph retrieval [4]. GraphRAG contributes multi-level extraction and synthesis [5]. Generative Agents motivates reflection as a higher-order process [6], and LongMemEval motivates temporal update and abstention evaluation [7]. The proposed contribution is the ownership-and-internalization model, scene-local identity precedence, deferred inquiry, and endorsement-centered longitudinal evaluation.

### 4.1 Limitations

An N-of-1 primary study can establish fidelity for the target user but not population generality. Self-recognition may reward familiar verbal quirks over sound reasoning, so safety and evidence gates are mandatory. External source quality remains a major confound: a system can accurately internalize poor knowledge. Value inference is inherently uncertain and culturally dependent. The system may also overfit to interview rhetoric unless cross-scenario testing is enforced. Finally, autonomous learning from commercial platforms introduces legal, availability, and recommendation-bias risks.

### 4.2 Future work

Future work will examine multi-user replication, spoken prosody, source-quality calibration, counterfactual value probes, causal analysis of experience-to-belief formation, and controlled fine-tuning of expression after sufficient confirmed examples exist. Fine-tuning will remain limited to expression policy; factual knowledge, experience, and values must remain editable and provenance-aware.

## 5. Conclusion

MindClone proposes a falsifiable architecture for an agent that learns external knowledge, negotiates meaning with its user, maintains a temporally coherent but socially flexible model of values, and answers through scene-appropriate personal evidence and expression. Its success is defined not by memory volume or surface imitation, but by whether the user recognizes, endorses, and can honestly deliver the resulting answer. The framework makes interview performance the first rigorous test while preserving a path toward general cognitive assistance across domains.

## Acknowledgments

No external funding has been received at the design-manuscript stage. The authors acknowledge the open-source communities maintaining Mem0, Graphiti, HippoRAG, Microsoft GraphRAG, whisper.cpp, and the broader long-term-memory research ecosystem.

## Conflict of Interest

The authors declare no commercial or financial conflict of interest related to this design manuscript.

## Data and Code Availability

The current prototype and design materials are maintained in the local MindClone workspace. Evaluation data contain longitudinal user interactions and will require an explicit release and anonymization decision before public distribution. Reference implementations are linked below and are not incorporated as production dependencies at this stage.

## References

1. Packer C, Wooders S, Lin K, et al. MemGPT: Towards LLMs as Operating Systems. arXiv:2310.08560. 2023.
2. Chhikara P, Khant D, Aryan S, Singh T, Yadav D. Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory. arXiv:2504.19413. 2025.
3. Rasmussen P, Paliychuk P, Beauvais T, Ryan J, Chalef D. Zep: A Temporal Knowledge Graph Architecture for Agent Memory. arXiv:2501.13956. 2025.
4. Gutiérrez BJ, Shu Y, Gu Y, Yasunaga M, Su Y. HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models. Advances in Neural Information Processing Systems. 2024.
5. Edge D, Trinh H, Cheng N, Bradley J, Chao A, Mody A, Truitt S, Larson J. From Local to Global: A Graph RAG Approach to Query-Focused Summarization. arXiv:2404.16130. 2024.
6. Park JS, O'Brien JC, Cai CJ, Morris MR, Liang P, Bernstein MS. Generative Agents: Interactive Simulacra of Human Behavior. Proceedings of UIST. 2023.
7. Wu D, Wang H, Yu W, Zhang Y, Chang K-W, Yu D. LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory. arXiv:2410.10813. 2024.
8. Sarthi P, Abdullah S, Tuli A, Khanna S, Goldie A, Manning CD. RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval. arXiv:2401.18059. 2024.
9. Liu NF, Lin K, Hewitt J, et al. Lost in the Middle: How Language Models Use Long Contexts. Transactions of the Association for Computational Linguistics. 2024;12:157–173.
10. Lewis P, Perez E, Piktus A, et al. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. Advances in Neural Information Processing Systems. 2020;33:9459–9474.

## 中文审阅说明（非投稿正文）

这篇论文不是对当前项目的包装，而是项目下一阶段必须服从的研究蓝图。它提出的核心判断是：系统不能直接把“看过的知识”当成“我的观点”，也不能把“对话里的长期身份”机械地压过当前场景中用户明确授权的身份材料。

在面试场景中，用户提交的本次简历构成场景契约。在该场景内，它优先于一般聊天中出现的职业身份；但它不会改写长期自我。外部知识先进入理解层，经过讨论、认同或实际应用后才进入内化层。系统可以主动挑战用户，但冲突观点必须通过确认完成更新。旧观点从认知层删除，原始聊天仍保留，并通过删除标记防止旧观点被重复抽取。

最终验收不是“回答听起来聪明”，而是用户在匿名对比中认为“这就是我会说的话，而且我愿意直接说出口”，同时系统没有编造经历、混淆第三方案例或违反当前场景材料。
