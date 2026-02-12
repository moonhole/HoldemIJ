#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required but not found in PATH" >&2
    exit 1
fi

mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/holdem_lite-${STAMP}.sql.gz"

docker compose -f docker-compose.experience.yml exec -T db \
    pg_dump -U postgres -d holdem_lite | gzip > "${OUT}"

echo "backup written: ${OUT}"
