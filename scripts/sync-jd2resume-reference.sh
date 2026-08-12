#!/usr/bin/env sh
set -eu

repo_url="https://github.com/russel-the-menace/JD2Resume.git"
branch="master"
target="reference-project/JD2Resume"

if [ -d "$target/.git" ]; then
  if ! git -C "$target" diff --quiet || ! git -C "$target" diff --cached --quiet; then
    echo "Reference cache has local changes. Commit, stash, or discard them before syncing." >&2
    exit 1
  fi
  git -C "$target" fetch --prune origin "$branch"
  git -C "$target" switch "$branch"
  git -C "$target" pull --ff-only origin "$branch"
else
  mkdir -p reference-project
  git clone --branch "$branch" --single-branch "$repo_url" "$target"
fi

echo "JD2Resume reference is current at $(git -C "$target" rev-parse --short HEAD)."
