#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required}"
corepack pnpm db:test:migrate
export NODE_ENV=test
corepack pnpm --filter @favlib/api exec vitest run test/catalog.integration.test.ts
corepack pnpm --filter @favlib/worker exec vitest run src/integration.test.ts
