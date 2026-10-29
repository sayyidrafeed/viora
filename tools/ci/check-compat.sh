#!/usr/bin/env bash
# Perubahan kontrak terhadap base: skema event (BACKWARD, ADR 027) dan spec OpenAPI (oasdiff, tanpa breaking change).
set -euo pipefail
cd "$(dirname "$0")/../.."
base="${1:?pakai: check-compat.sh <git-ref-base>}"
tmp="$(mktemp -d)"

if git show "$base:packages/contracts/event-schemas.json" > "$tmp/event-schemas.json" 2>/dev/null; then
  (cd packages/contracts && bun scripts/schemas.ts --compat "$tmp/event-schemas.json")
else
  echo "base belum punya event-schemas.json, cek kompatibilitas event dilewati"
fi

for spec in apps/*/openapi.json; do
  if git show "$base:$spec" > "$tmp/base.json" 2>/dev/null; then
    docker run --rm -v "$tmp:/base:ro" -v "$PWD:/head:ro" tufin/oasdiff:v1.35.0 breaking /base/base.json "/head/$spec" --fail-on ERR
  else
    echo "$spec baru di branch ini, oasdiff dilewati"
  fi
done
