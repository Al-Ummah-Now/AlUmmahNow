#!/usr/bin/env bash
# Build (or rebuild) the D1 search index from R2 (Epic 29, Story 29.9).
#
# Usage:
#   INTERNAL_API_KEY=... ./scripts/search-backfill.sh https://videos.api.qa.alummahnow.net [entity ...]
#
# Walks every bucket page by page through POST /internal/search/backfill, then
# prunes rows that were not refreshed during this run (objects that no longer exist).
# Entities default to: channel video playlist post (channels first so their
# visibility applies to the content they own).
set -euo pipefail

BASE_URL="${1:?usage: search-backfill.sh <api base url> [entity ...]}"
shift || true
ENTITIES=("${@:-channel video playlist post}")
# shellcheck disable=SC2206
ENTITIES=(${ENTITIES[*]})
: "${INTERNAL_API_KEY:?set INTERNAL_API_KEY}"
PAGE_SIZE="${PAGE_SIZE:-50}"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

# 5 minutes of margin for clock skew between this machine and the Worker.
STARTED_AT=$(( $(date +%s) * 1000 - 300000 ))

for entity in "${ENTITIES[@]}"; do
  cursor=""
  pages=0
  totals='{"scanned":0,"indexed":0,"hidden":0,"removed":0,"unchanged":0,"failed":0}'
  while :; do
    url="$BASE_URL/internal/search/backfill?entity=$entity&limit=$PAGE_SIZE"
    [ -n "$cursor" ] && url="$url&cursor=$(jq -rn --arg c "$cursor" '$c|@uri')"
    response=$(curl -sS -X POST -H "X-API-Key: $INTERNAL_API_KEY" "$url")
    if [ "$(echo "$response" | jq -r '.success')" != "true" ]; then
      echo "[$entity] backfill failed: $response" >&2
      exit 1
    fi
    totals=$(jq -c --argjson page "$response" '
      .scanned += $page.scanned | .indexed += $page.indexed | .hidden += $page.hidden |
      .removed += $page.removed | .unchanged += $page.unchanged | .failed += $page.failed' <<<"$totals")
    pages=$((pages + 1))
    cursor=$(echo "$response" | jq -r '.nextCursor // empty')
    [ -z "$cursor" ] && break
  done
  curl -sS -X POST -H "X-API-Key: $INTERNAL_API_KEY" \
    "$BASE_URL/internal/search/backfill?entity=$entity&prune=$STARTED_AT" >/dev/null
  echo "[$entity] $pages page(s): $totals (pruned rows older than this run)"
done

curl -sS -H "X-API-Key: $INTERNAL_API_KEY" "$BASE_URL/internal/search/stats" | jq '.tables'
