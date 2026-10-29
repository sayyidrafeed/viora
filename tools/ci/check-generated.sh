#!/usr/bin/env bash
# Gagal kalau file hasil generate tidak sesuai sumbernya (spec OpenAPI, kong.yaml, skema event, api-client, routeTree).
set -euo pipefail
cd "$(dirname "$0")/../.."
(cd apps/identity-svc && bun run openapi)
bun run kong:config --check
(cd packages/contracts && bun scripts/schemas.ts --check)
(cd packages/api-client && bun run generate)
(cd apps/web && bunx vite build)
rm -rf apps/web/dist
git diff --exit-code -- apps/identity-svc/openapi.json packages/api-client/src/generated apps/web/src/routeTree.gen.ts
