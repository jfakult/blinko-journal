#!/usr/bin/env bash
# Report how far the current branch has drifted from upstream/main, without merging.
set -euo pipefail

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "No 'upstream' remote configured. Run:" >&2
  echo "  git remote add upstream https://github.com/blinkospace/blinko.git" >&2
  exit 1
fi

echo "Fetching upstream..."
git fetch upstream --quiet

branch=$(git rev-parse --abbrev-ref HEAD)
ahead=$(git rev-list --count upstream/main.."$branch")
behind=$(git rev-list --count "$branch"..upstream/main)

echo "Branch '$branch' vs upstream/main:"
echo "  ahead:  $ahead commit(s)"
echo "  behind: $behind commit(s)"

if [ "$behind" -gt 0 ]; then
  echo
  echo "New upstream commits:"
  git log --oneline "$branch"..upstream/main
fi
