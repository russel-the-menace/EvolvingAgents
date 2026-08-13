# JD2Resume Reference Sync

MindClone uses `JD2Resume` as an external design and implementation reference, particularly for JD parsing, resume data modeling, Gemini-assisted preparation, and experience-oriented prompts.

The directory `apps/mind-clone/reference-project/JD2Resume` is ignored by the EvolvingAgents Git repository. It is a source-only local mirror, not a vendored dependency and not a source of production imports. Its Git metadata lives outside the workspace in the local cache, so VS Code Source Control sees only the monorepo.

Run this before work that depends on its latest design:

```bash
npm run sync:mind-clone-reference
```

The script runs from the MindClone workspace, fetches `russel-the-menace/JD2Resume` from `master`, rebuilds the source mirror, and excludes `node_modules`, `dist`, and `build`. Do any JD2Resume development and commits in its own repository, then push there; MindClone will receive the published update on the next sync.

Do not install or commit its `node_modules` or `dist` output in EvolvingAgents. Its source remains available locally for inspection after synchronization.
