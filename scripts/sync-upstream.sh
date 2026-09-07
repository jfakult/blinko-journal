#!/usr/bin/env bash
# Merge upstream/main into a branch (default: the current branch).
# Usage: scripts/sync-upstream.sh [branch]
set -euo pipefail

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "No 'upstream' remote configured. Run:" >&2
  echo "  git remote add upstream https://github.com/blinkospace/blinko.git" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. Commit or stash your changes first." >&2
  exit 1
fi

target_branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"

echo "Fetching upstream..."
git fetch upstream --quiet

echo "Checking out '$target_branch'..."
git checkout "$target_branch"

echo "Merging upstream/main into '$target_branch'..."
if git merge upstream/main --no-edit; then
  echo "Merged cleanly. Review the changes, then push:"
  echo "  git push origin $target_branch"
else
  echo
  echo "Merge conflicts detected. Resolve them, then:"
  echo "  git add <resolved files>"
  echo "  git commit"
  echo "  git push origin $target_branch"
  echo
  echo "(or abort with: git merge --abort)"
  exit 1
fi
