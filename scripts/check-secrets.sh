#!/usr/bin/env bash
# Stops the deploy before wrangler runs when a GitHub Actions secret is missing or empty.
# Prints secret names only, never values.
set -euo pipefail

required=(
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  SLACK_SIGNING_SECRET
  SLACK_BOT_TOKEN
  CHANNEL_MAP
  RELAY_URLS
  RELAY_SECRETS
  BRIDGE_TOKEN
)

missing=0
for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "Missing secret: $name" >&2
    missing=$((missing + 1))
  fi
done

if [ "$missing" -gt 0 ]; then
  echo "$missing of ${#required[@]} deploy secrets are missing. Add them in the repo's Settings > Secrets and variables > Actions, then re-run this workflow. Nothing was deployed." >&2
  exit 1
fi
echo "All ${#required[@]} deploy secrets are set."
