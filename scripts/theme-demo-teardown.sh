#!/usr/bin/env bash
# Deletes the temporary theme demo Workers. Needs Cloudflare credentials for the account.
set -euo pipefail
for theme in lantern zujaj nahas fawanees; do
  npx wrangler delete --name "theme-demo-$theme" --force
done
