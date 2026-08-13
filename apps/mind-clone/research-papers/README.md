# MindClone Research Paper Corpus

This folder contains the literature corpus used for the MindClone novelty audit. All 41 PDFs listed in `papers.tsv` were downloaded from publisher, anthology, author, arXiv, or user-provided sources and validated with `pypdf`. Exact page counts, byte sizes, source URLs, and SHA-256 hashes are recorded in `verification.tsv`.

## Contents

- `00-surveys/`: cognitive architectures, agent memory, persona, and personalized alignment surveys;
- `01-memory-provenance/`: long-term memory, temporal state, attribution, and provenance;
- `02-digital-clone-persona/`: digital twins, self-clones, evolving personas, and identity conflict;
- `03-active-inquiry/`: preference elicitation, clarifying questions, and proactive personalization;
- `04-style-evaluation/`: author-style modeling and personalized-generation evaluation;
- `05-chinese/`: Chinese journal papers on personality alignment and moral judgment.

## Priority Reading

Read these first because they most directly constrain MindClone's novelty:

1. `01-memory-provenance/2026_Memory_Provenance_Laundering.pdf`
2. `01-memory-provenance/2026_PersonaAgent.pdf`
3. `01-memory-provenance/2026_Inside_Out_PersonaTree.pdf`
4. `01-memory-provenance/2026_CloneMem.pdf`
5. `01-memory-provenance/2026_KnowMe_Bench.pdf`
6. `02-digital-clone-persona/2026_TwinVoice.pdf`
7. `02-digital-clone-persona/2026_Persona_Conflict.pdf`
8. `02-digital-clone-persona/2025_Talk_Less_Call_Right.pdf`
9. `03-active-inquiry/2024_STaR_GATE.pdf`
10. `03-active-inquiry/2026_VitaBench_2.pdf`
11. `04-style-evaluation/2025_Catch_Me_Style_Imitation.pdf`

## Reproduce

Run the downloader with the Homebrew Python 3.14 environment:

```bash
python apps/mind-clone/research-papers/download_and_verify.py
```

Existing verified files are not downloaded again. Remove a PDF to force a fresh download. Edit `papers.tsv` to add or update sources.

## Scope

This is a scoping corpus, not an exhaustive systematic-review export. A submission-ready review should additionally search Web of Science, Scopus, ACM Digital Library, IEEE Xplore, CNKI, Wanfang, and patent databases using institutional access.
