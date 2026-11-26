#!/usr/bin/env bash
# Fails unless <deployment-url>/health answers 200. On failure it prints the status code and the body's
# `error` field only (a secret name, never a value). Retries because a new version takes a few seconds to serve.
set -euo pipefail

url="${1:-}"
if [ -z "$url" ]; then
  echo "No deployment URL to check. If this ran after a deploy, check that the Cloudflare account has a workers.dev subdomain." >&2
  exit 1
fi
attempts="${HEALTH_CHECK_ATTEMPTS:-6}"
delay="${HEALTH_CHECK_DELAY:-5}"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

status=""
for ((attempt = 1; attempt <= attempts; attempt++)); do
  status="$(curl -s -o "$body" -w '%{http_code}' --max-time 10 "${url%/}/health" || true)"
  if [ "$status" = "200" ]; then
    echo "/health returned 200."
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$delay"
  fi
done

error="$(jq -r 'if type == "object" and (.error | type) == "string" then .error else empty end' "$body" 2>/dev/null || true)"
echo "/health returned ${status:-no response} after $attempts attempt(s): ${error:-no error field}" >&2
exit 1
