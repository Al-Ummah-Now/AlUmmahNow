#!/usr/bin/env bash
# Run inside the deploy job's concurrency group, after checkout sets up origin.
set -euo pipefail

remote_ref=$(git ls-remote --exit-code origin refs/heads/main)
head_commit=${remote_ref%%$'\t'*}
if [[ "$head_commit" == "$GITHUB_SHA" ]]; then
  echo "current=true" >> "$GITHUB_OUTPUT"
else
  echo "current=false" >> "$GITHUB_OUTPUT"
  echo "::notice::QA deployment skipped for ${GITHUB_SHA:0:7}. Main is at ${head_commit:0:7}."
fi
