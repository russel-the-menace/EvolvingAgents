# Evolving Agents

Evolving Agents is a monorepo for knowledge-driven agents that share a source-to-evidence learning engine while keeping product-specific cognition and policy in adapters.

## Workspaces

| Workspace | Purpose |
| --- | --- |
| [`apps/mindclone`](apps/mindclone) | A longitudinal personal agent with identity, internalization, style, and interview-scene controls. |
| [`apps/campus-atlas`](apps/campus-atlas) | CampusAtlas, a campus knowledge agent for authenticated policies, documents, and evidence-backed answers. |
| [`packages/learning-engine`](packages/learning-engine) | Domain-neutral ingestion, claim/evidence persistence, retrieval, validity, and citation contracts. |

MindClone and CampusAtlas are applications, not nested Git repositories. The root is the only Git repository, and npm workspaces link both applications to the same learning-engine package.

## Commands

```bash
npm install
npm run dev
npm test
npm run check
npm run build
```

`npm run dev` starts MindClone. CampusAtlas currently contains its learning-domain foundation and tests; its crawler, authenticated credential vault, answer service, and interface are intentionally not stubbed as finished features.

Run an individual workspace with:

```bash
npm test --workspace @evolving-agents/campus-atlas
npm test --workspace @evolving-agents/learning-engine
npm run dev --workspace @evolving-agents/mindclone
```

Research material and implementation references remain at the repository root because they inform more than one application.

See [`docs/monorepo.md`](docs/monorepo.md) for dependency direction, code ownership, shared-engine change rules, and the criteria for eventually extracting the engine into its own repository.
