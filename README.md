# EvolvingAgents

EvolvingAgents is a monorepo for knowledge-driven agents that share an evidence-grounded learning engine while keeping product cognition, data, policy, and action boundaries separate.

## Workspaces

| Workspace | Purpose |
| --- | --- |
| [`apps/mind-clone`](apps/mind-clone) | MindClone, a longitudinal personal agent with identity, internalization, style, and interview-scene controls. |
| [`apps/campus-atlas`](apps/campus-atlas) | CampusAtlas, a campus knowledge agent for authenticated policies, documents, and evidence-backed answers. |
| [`apps/crypto-agent`](apps/crypto-agent) | CryptoAgent, a planned financial research and constrained automation agent; currently a knowledge adapter and implementation record. |
| [`packages/learning-engine`](packages/learning-engine) | Domain-neutral ingestion, claim/evidence persistence, retrieval, validity, and citation contracts. |

The three products are npm workspaces, not nested product repositories. The root is the only product Git repository, and every application imports the same learning-engine workspace package.

## Commands

```bash
npm install
npm run dev -- mind-clone
npm run desktop -- mind-clone
npm test
npm run check
npm run build
```

The root has no default application. `npm run dev -- mind-clone` (or `npm run dev -- mindclone`) explicitly starts MindClone. Running `npm run dev` without an application only prints the available names. CampusAtlas and CryptoAgent currently contain their learning-domain foundations and tests; unfinished acquisition, answer, research, risk, and execution systems are documented rather than presented as implemented.

Run an individual workspace with:

```bash
npm test --workspace @evolving-agents/campus-atlas
npm test --workspace @evolving-agents/crypto-agent
npm test --workspace @evolving-agents/learning-engine
cd apps/mind-clone && npm run dev
```

Research papers and reference implementations belong to their application. MindClone's existing corpus is under `apps/mind-clone`; CryptoAgent has empty project-specific directories ready for future curation. Only cross-application architecture documents remain at the root.

See [`docs/monorepo.md`](docs/monorepo.md) for dependency direction, code ownership, shared-engine change rules, and the criteria for eventually extracting the engine into its own repository.
