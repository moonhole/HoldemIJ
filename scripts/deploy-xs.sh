#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required but not found in PATH" >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose plugin is required but not available" >&2
    exit 1
fi

generate_password() {
    cat /proc/sys/kernel/random/uuid | tr -d '-' | cut -c 1-24
}

ensure_postgres_password() {
    local current generated
    current="$(grep -E '^POSTGRES_PASSWORD=' .env | tail -n1 | cut -d= -f2- || true)"
    if [ -n "${current}" ] && [ "${current}" != "change_me" ]; then
        return 0
    fi

    generated="$(generate_password)"
    if grep -qE '^POSTGRES_PASSWORD=' .env; then
        sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${generated}|" .env
    else
        printf "\nPOSTGRES_PASSWORD=%s\n" "${generated}" >> .env
    fi
    echo "auto-generated POSTGRES_PASSWORD in .env"
}

if [ ! -f .env ]; then
    cp .env.example .env
    echo "created .env from .env.example"
fi

ensure_postgres_password

docker compose -f docker-compose.experience.yml up -d --build
docker compose -f docker-compose.experience.yml ps
