#!/usr/bin/env sh
set -eu

repo_url="https://github.com/russel-the-menace/JD2Resume.git"
branch="master"
target="reference-project/JD2Resume"
cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/mindclone"
cache_repo="$cache_root/jd2resume.git"

mkdir -p "$cache_root" "$target"

if [ ! -d "$cache_repo" ]; then
  git clone --bare "$repo_url" "$cache_repo"
fi

git --git-dir="$cache_repo" fetch --prune origin \
  "+refs/heads/$branch:refs/remotes/origin/$branch"
commit="$(git --git-dir="$cache_repo" rev-parse "refs/remotes/origin/$branch")"

# The reference is deliberately a source-only mirror, not a nested repository.
# This keeps VS Code Source Control focused on EvolvingAgents and drops checked-in
# dependency/build directories from the reference workspace.
find "$target" -mindepth 1 -depth -delete
git --git-dir="$cache_repo" archive "$commit" -- . \
  ':(exclude,glob)**/node_modules/**' \
  ':(exclude,glob)**/dist/**' \
  ':(exclude,glob)**/build/**' | tar -xf - -C "$target"

echo "JD2Resume reference is current at ${commit%${commit#????????}}."
