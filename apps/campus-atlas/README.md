# CampusAtlas

CampusAtlas is the campus-policy application in the EvolvingAgents monorepo. Its current scope is the learning-domain foundation: it maps extracted policy proposals onto the shared learning engine with publisher authority, access scope, department, validity, evidence, and citation rules.

Implemented and tested:

- policy claim and exact source-evidence mapping;
- public versus authenticated retrieval filtering;
- validity-window filtering, including the final valid day;
- evidence-required authorization;
- abstention for unrelated questions;
- long-document chunk coverage;
- rejection of credentials in learning metadata.

Still application work:

- authenticated crawler and encrypted credential vault;
- HTML, PDF, Office, table, and OCR parsing;
- model-backed campus policy extractor;
- source version and supersession policy;
- semantic retrieval and reranking;
- evidence-grounded answer API and user interface.

Authentication cookies belong to the acquisition layer and must never enter learning-engine metadata, chunks, model prompts, or logs.

```bash
npm test --workspace @evolving-agents/campus-atlas
```
