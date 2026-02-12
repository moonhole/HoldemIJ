# holdem-lite

Lightweight Texas Hold'em monorepo:
- `apps/server`: Go WebSocket game server + auth API
- `apps/h5`: React + PixiJS client
- `proto`: protobuf contract
- `holdem`: core game engine

This README reflects the current state of the project (auth + DB + H5 flow).

## Current stack
- Frontend: React, PixiJS, Zustand, Vite
- Realtime protocol: protobuf over WebSocket
- Backend: Go (`net/http`, `gorilla/websocket`)
- Auth persistence modes:
  - `db` (PostgreSQL, default)
  - `memory` (in-memory, for quick local runs)

## Repo layout
```text
apps/
  h5/
    docs/
      H5_SOLUTION.md
  server/
    db/
      create_database.sql
      schema.sql
      002_seed.sql
proto/
holdem/
card/
```

## Docs
- H5 implementation notes: `apps/h5/docs/H5_SOLUTION.md`

## Prerequisites
- Go `1.23+`
- Node.js `20+`
- pnpm `9+`
- PostgreSQL `16+` (or Docker postgres)

## Install
```bash
pnpm install
```

## Database setup (for AUTH_MODE=db)
Run once:

```bash
psql -U postgres -d postgres -f apps/server/db/create_database.sql
psql -U postgres -d holdem_lite -f apps/server/db/schema.sql
psql -U postgres -d holdem_lite -f apps/server/db/002_seed.sql
```

If you use Docker-based `psql` wrapper in this workspace, the same commands work.

## Run (recommended: db mode)
Server:

```bash
# Optional, defaults shown here
export AUTH_MODE=db
export AUTH_DATABASE_DSN="postgresql://postgres:postgres@localhost:5432/holdem_lite?sslmode=disable"
export AUTH_SESSION_TTL="720h"

pnpm dev:server
```

PowerShell equivalent:

```powershell
$env:AUTH_MODE = "db"
$env:AUTH_DATABASE_DSN = "postgresql://postgres:postgres@localhost:5432/holdem_lite?sslmode=disable"
$env:AUTH_SESSION_TTL = "720h"
pnpm dev:server
```

H5 client:

```bash
pnpm dev
```

Open: `http://127.0.0.1:5173`

Vite proxy forwards:
- `/api` -> `http://127.0.0.1:8080`
- `/ws` -> `ws://127.0.0.1:8080`

## Run (memory mode)
Useful for fast server-only debugging without PostgreSQL:

```bash
export AUTH_MODE=memory
pnpm dev:server
```

PowerShell:

```powershell
$env:AUTH_MODE = "memory"
pnpm dev:server
```

## Auth API
Base URL: `http://127.0.0.1:8080`

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /health`
- `GET /ws?session_token=...`

Notes:
- WebSocket requires a valid `session_token`.
- Client gets token via login/register, then reconnects with token.

## Seed test accounts
From `apps/server/db/002_seed.sql`:
- Username: `dev_admin`
- Username: `dev_player1`
- Password (both): `password`

## Dev commands
```bash
# H5 dev
pnpm dev

# Server dev
pnpm dev:server

# H5 production build
pnpm build

# Build replay WASM bundle for local replay controls
pnpm build:replay-wasm

# Regenerate protobuf code
pnpm proto
```

## AUTH_MODE and env vars
- `AUTH_MODE`: `db` (default) or `memory`
- `AUTH_DATABASE_DSN`: postgres DSN used when `AUTH_MODE=db`
- `DATABASE_URL`: fallback DSN if `AUTH_DATABASE_DSN` is empty
- `AUTH_SESSION_TTL`: Go duration string, default `720h` (30 days)

## Common issues
1. `auth schema not initialized: missing table accounts`
   - Run DB scripts in `apps/server/db/` in order.
2. `unauthorized: invalid session token` on `/ws`
   - Login first and ensure client is using current token.
3. Cannot reach client from LAN
   - Vite binds `0.0.0.0:5173`; make sure local firewall allows port `5173`.
