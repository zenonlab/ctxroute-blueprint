#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must point to a separate *_test database}"
database_name="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))' "$TEST_DATABASE_URL")"
[[ "$database_name" =~ _test$ ]] || { echo "TEST_DATABASE_URL must target a database ending in _test" >&2; exit 1; }
[[ "$database_name" =~ ^[A-Za-z0-9_]+$ ]] || { echo "TEST_DATABASE_URL database name contains unsupported characters" >&2; exit 1; }
if [[ -n "${DATABASE_URL:-}" && "$DATABASE_URL" == "$TEST_DATABASE_URL" ]]; then
  echo "TEST_DATABASE_URL must differ from DATABASE_URL" >&2
  exit 1
fi
admin_url="${TEST_DATABASE_URL%/*}/postgres"
if [[ -z "$(psql "$admin_url" -tAc "SELECT 1 FROM pg_database WHERE datname = '$database_name'")" ]]; then
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database_name\""
fi
DATABASE_URL="$TEST_DATABASE_URL" corepack pnpm --filter @favlib/api db:migrate
