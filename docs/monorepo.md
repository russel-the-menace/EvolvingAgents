# Monorepo Boundaries

## Dependency Direction

```text
apps/mind-clone ---------+
apps/campus-atlas -------+--> packages/learning-engine
apps/crypto-agent -------+
```

Applications may import the learning engine. The learning engine must never import application code or contain MindClone, interview, campus, school, scholarship, or other domain concepts.

## Ownership

| Path | Owns |
| --- | --- |
| `apps/mind-clone` | Personal cognition, internalization, identity, style, scene overrides, interview behavior, and its research corpus. |
| `apps/campus-atlas` | Campus source authority, access policy, validity semantics, extraction schema, answers, and acquisition. |
| `apps/crypto-agent` | Financial knowledge policy and, later, separately isolated research, risk, and execution systems. |
| `packages/learning-engine` | Domain-neutral source, chunk, claim, evidence, lifecycle, retrieval, and citation contracts. |
| `docs` | Cross-application architecture and engine extraction decisions only. |

## Change Rule

A change belongs in the learning engine only when it fixes a domain-neutral invariant or is plausibly required by more than one application. Every engine change must include a core regression test and pass all application suites. Domain fields and behavior belong in the owning application adapter, usually through claim `attributes` or policy hooks.

The root commands enforce the current contract:

```bash
npm test
npm run check
npm run build
```

Applications may be developed independently with npm workspace commands, but they are versioned in the same Git commit. Product source directories must not contain nested `.git` repositories. Ignored, read-only repositories under an application's `reference-project` directory are research caches, never production imports.

## Extraction Trigger

Keep the learning engine in this monorepo while its API is evolving. Move it to a dedicated repository only after at least two applications have used it in real workflows, schema migrations are versioned, and changes no longer routinely require coordinated application edits. At that point, applications should consume immutable releases rather than a branch or copied source.
