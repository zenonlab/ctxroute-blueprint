#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

compose_file="infra/compose.yaml"
compose=(docker compose --env-file "$repo_root/.env" -f "$repo_root/$compose_file")
backup_path="${FAVLIB_BACKUP_PATH:-$repo_root/.runtime/backups}"
mkdir -p "$backup_path"
export FAVLIB_BACKUP_PATH="$backup_path"

"${compose[@]}" up -d --build

required_services=(postgres api worker web caddy)
deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
  all_healthy=1
  for service in "${required_services[@]}"; do
    container_id="$("${compose[@]}" ps -q "$service")"
    if [[ -z "$container_id" ]]; then
      all_healthy=0
      break
    fi
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    if [[ "$status" != "healthy" ]]; then
      all_healthy=0
      break
    fi
  done
  if (( all_healthy )); then
    echo "FavLib est lancé: PostgreSQL, API, worker, web et Caddy sont healthy."
    "${compose[@]}" ps
    exit 0
  fi
  sleep 2
done

echo "La stack FavLib n'est pas entièrement healthy après 180 secondes." >&2
"${compose[@]}" ps >&2
"${compose[@]}" logs --tail=100 >&2
exit 1
