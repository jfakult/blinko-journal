#!/bin/bash
# Quick, quiet local rebuild: build blinko-website, only show output on failure,
# only recreate the container if the resulting image actually changed (no
# --force-recreate, so an unchanged rebuild doesn't needlessly bounce the app).
set -e

cd "$(dirname "$0")/.."

log=$(mktemp)
trap 'rm -f "$log"' EXIT

start=$(date +%s)
echo "Building blinko-website..."

if docker compose build blinko-website > "$log" 2>&1; then
  elapsed=$(( $(date +%s) - start ))
  echo "Build OK (${elapsed}s)"
else
  echo "Build FAILED - last 60 lines:"
  echo "---"
  tail -60 "$log"
  exit 1
fi

docker compose up -d blinko-website
