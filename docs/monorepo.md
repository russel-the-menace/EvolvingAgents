# Monorepo Boundaries

## Dependency Direction

```text
apps/mindclone -----------+
                         +--> packages/learning-engine
apps/campus-atlas -------+
```

Applications may import the learning engine. The learning engine must never import application code or contain MindClone, interview, campus, school, scholarship, or other domain concepts.

## Ownership

| Path | Owns |
| --- | --- |
| `apps/mindclone` | Personal cognition, internalization, identity, style, scene overrides, and interview behavior. |
| `apps/campus-atlas` | Campus source authority, access policy, validity semantics, extraction schema, answers, and acquisition. |
| `packages/learning-engine` | Domain-neutral source, chunk, claim, evidence, lifecycle, retrieval, and citation contracts. |
| `docs`, `research-papers`, `reference-project` | Cross-application research and architecture evidence. |

## Change Rule

A change belongs in the learning engine only when it fixes a domain-neutral invariant or is plausibly required by more than one application. Every engine change must include a core regression test and pass both application suites. Domain fields and behavior belong in the owning application adapter, usually through claim `attributes` or policy hooks.

The root commands enforce the current contract:

```bash
npm test
npm run check
npm run build
```

Applications may be developed independently with npm workspace commands, but they are versioned in the same Git commit. There must be no nested `.git` directory under `apps`.

## Extraction Trigger

Keep the learning engine in this monorepo while its API is evolving. Move it to a dedicated repository only after MindClone and CampusAtlas have both used it in real workflows, schema migrations are versioned, and changes no longer routinely require coordinated application edits. At that point, applications should consume immutable releases rather than a branch or copied source.
