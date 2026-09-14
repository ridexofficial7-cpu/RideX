#!/usr/bin/env bash
set -euo pipefail
# Production promotion is intentionally gated: the release must already be APPROVED by Super Admin.
: "${RIDEX_RELEASE_ID:?RIDEX_RELEASE_ID is required}"
: "${RIDEX_ADMIN_API_URL:?RIDEX_ADMIN_API_URL is required}"
: "${RIDEX_ADMIN_TOKEN:?RIDEX_ADMIN_TOKEN is required}"
curl --fail-with-body -X POST "$RIDEX_ADMIN_API_URL/api/v1/admin/platform/releases/$RIDEX_RELEASE_ID/promote" \
  -H "Authorization: Bearer $RIDEX_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data '{"confirmation":"PROMOTE TO LIVE"}'
echo "Release promoted to LIVE."
