# Commit Conventions

Every commit must identify the product or shared package it changes. The repository uses this format:

```text
<type>(<scope>[,<scope>...]): <subject>
```

Allowed types are `feat`, `fix`, `style`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`, and `revert`. Every other type is rejected. The subject is required and must be no longer than 100 characters.

## Scopes

| Scope | Files |
| --- | --- |
| `mind-clone` | `apps/mind-clone/**` |
| `campus-atlas` | `apps/campus-atlas/**` |
| `crypto-agent` | `apps/crypto-agent/**` |
| `learning-engine` | `packages/learning-engine/**` |
| `monorepo` | Root tooling/configuration, cross-application docs, or coordinated changes across at least two apps and the engine. |

Examples:

```text
feat(mind-clone): add interview evidence review
fix(campus-atlas): reject expired policy evidence
style(mind-clone): align chat message actions
feat(crypto-agent,learning-engine): add known-at retrieval filtering
docs(mind-clone): update research corpus notes
refactor(monorepo): align shared retrieval contracts across agents
chore(monorepo): update workspace scripts
```

## Scope Derivation Rules

1. A commit touching one app uses that app's scope.
2. A commit touching one app and `packages/learning-engine` lists both scopes in alphabetical order.
3. A commit touching two or more apps and `packages/learning-engine` must use exactly `monorepo`; do not enumerate the individual scopes.
4. A commit touching two or more apps without the engine lists every app scope in alphabetical order.
5. A root-only or cross-cutting tooling/documentation change uses `monorepo`.
6. Do not use `monorepo` for a change confined to one app or one app plus the engine.

The `commit-msg` hook reads the staged file paths and rejects a header whose scopes do not match these rules. `npm install` configures `.githooks` automatically. CI repeats the same check because local hooks can be bypassed with `--no-verify`.

Run the focused tests with:

```bash
npm run test:commit-policy
```
