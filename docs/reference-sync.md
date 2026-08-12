# JD2Resume Reference Sync

MindClone uses `JD2Resume` as an external design and implementation reference, particularly for JD parsing, resume data modeling, Gemini-assisted preparation, and experience-oriented prompts.

The directory `reference-project/JD2Resume` is ignored by MindClone Git. It is a local cache of the GitHub repository, not a vendored dependency and not a source of production imports.

Run this before work that depends on its latest design:

```bash
npm run sync:reference
```

The script fetches `russel-the-menace/JD2Resume`, checks out `master`, and only performs a fast-forward update. If the cache has local edits, it stops rather than overwriting them. Do any JD2Resume development and commits in its own repository, then push there; MindClone will receive the published update on the next sync.

Do not install or commit its `node_modules` or `dist` output in MindClone. Its source remains available locally for inspection after synchronization.
