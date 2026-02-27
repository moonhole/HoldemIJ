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
  - `local` (SQLite file on local disk, recommended for desktop single-machine play)
  - `memory` (in-memory, for quick local runs)
- Ledger/Audit persistence:
  - `db` mode: PostgreSQL
  - `local` mode: SQLite local file
  - `memory` mode: noop in-memory (for quick local runs)

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
      003_ledger_audit.sql
proto/
holdem/
card/
```

## Docs
- H5 implementation notes: `apps/h5/docs/H5_SOLUTION.md`
- Desktop frame stability roadmap: `desktop_perf_roadmap.md`

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
psql -U postgres -d holdem_lite -f apps/server/db/003_ledger_audit.sql
psql -U postgres -d holdem_lite -f apps/server/db/004_story_progress.sql
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
- `/api` -> `http://127.0.0.1:18080`
- `/ws` -> `ws://127.0.0.1:18080`

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

## Run (local mode)
Use a local SQLite file for auth + story + audit/ledger persistence:

```bash
export AUTH_MODE=local
export LOCAL_DATABASE_PATH="./.local/holdem_local.db"
pnpm dev:server
```

PowerShell:

```powershell
$env:AUTH_MODE = "local"
$env:LOCAL_DATABASE_PATH = ".\\.local\\holdem_local.db"
pnpm dev:server
```

## Auth API
Base URL: `http://127.0.0.1:18080`

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/audit/live/recent?limit=20`
- `GET /api/audit/live/hands/{hand_id}`
- `POST /api/audit/live/hands/{hand_id}/save`
- `DELETE /api/audit/live/hands/{hand_id}/save`
- `GET /api/audit/replay/recent?limit=20`
- `GET /api/audit/replay/hands/{hand_id}`
- `POST /api/audit/replay/hands/{hand_id}` (upsert replay tape/events)
- `POST /api/audit/replay/hands/{hand_id}/save`
- `DELETE /api/audit/replay/hands/{hand_id}/save`
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

# Electron desktop dev (Windows-first)
pnpm desktop:dev

# Server dev
pnpm dev:server

# H5 production build
pnpm build

# Build replay WASM bundle for local replay controls
pnpm build:replay-wasm

# Build Windows installer (Electron + H5 desktop bundle)
pnpm desktop:build:win

# Phase 0 baseline sampling (desktop perf/cpu/gpu)
pnpm desktop:perf:phase0

# Regenerate protobuf code
pnpm proto
```

Desktop notes:
- Desktop runtime network is scenario-based (`local`, `remote`, `auto`) and resolved at app start.
- `desktop:dev` defaults to `auto` -> `local`: starts a managed local Go server process (`AUTH_MODE=local`).
- `desktop:dev` prepares local server runtime first, then Electron prefers local binary runtime over `go run`.
- Desktop managed local server listens on `127.0.0.1:18080` by default (`SERVER_ADDR` override supported).
- Closing Electron (window `X` or `Exit`) also shuts down the managed local server process.
- If `18080` is still occupied by a stale local process on next start, desktop startup will try to clean it automatically.
- `desktop:build:win` output is generated under `apps/desktop/release/`.

## AUTH_MODE and env vars
- `AUTH_MODE`: `db` (default), `local`, or `memory`
- `AUTH_DATABASE_DSN`: postgres DSN used when `AUTH_MODE=db`
- `DATABASE_URL`: fallback DSN if `AUTH_DATABASE_DSN` is empty
- `AUTH_SESSION_TTL`: Go duration string, default `720h` (30 days)
- `LEDGER_DATABASE_DSN`: optional DSN override for ledger/audit tables (defaults to `AUTH_DATABASE_DSN`)
- `LOCAL_DATABASE_PATH`: sqlite file path used by local mode if service-specific local paths are not set
- `AUTH_LOCAL_DATABASE_PATH`: optional auth sqlite path override
- `STORY_LOCAL_DATABASE_PATH`: optional story sqlite path override
- `LEDGER_LOCAL_DATABASE_PATH`: optional ledger/audit sqlite path override
- `AUDIT_RECENT_LIMIT_X`: recent unsaved hands retained per user/source (default `200`)
- `AUDIT_SAVED_LIMIT_Y`: max saved hands per user/source (default `50`)
- `SERVER_ADDR`: server listen address (default `:18080`; desktop local mode uses `127.0.0.1:18080`)

Desktop-specific env (Electron main process):
- `ELECTRON_NETWORK_SCENARIO`: `local`, `remote`, or `auto` (default: `auto`)
- `ELECTRON_LOCAL_SERVER`: enable/disable managed local server (`1` default, set `0` to disable)
- `ELECTRON_LOCAL_SERVER_REUSE_EXISTING`: reuse already-running service on local endpoint (`0` default)
- `ELECTRON_LOCAL_SERVER_BINARY`: explicit local server binary path override
- `ELECTRON_GO_BINARY`: Go binary override for desktop dev source-run mode (`go` by default)
- `ELECTRON_LOCAL_SERVER_HOST`: host override for managed local server (default `127.0.0.1`)
- `ELECTRON_LOCAL_SERVER_PORT`: port override for managed local server (default `18080`)
- `ELECTRON_LOCAL_SERVER_START_TIMEOUT_MS`: startup timeout for `/health` check (default `25000`)
- `ELECTRON_LOCAL_SERVER_POLL_MS`: polling interval for `/health` check (default `300`)
- `ELECTRON_REMOTE_API_BASE_URL` (or `ELECTRON_API_BASE_URL`): remote API base URL for remote scenario
- `ELECTRON_REMOTE_WS_URL` (or `ELECTRON_WS_URL`): remote websocket URL for remote scenario

Desktop scenario examples (PowerShell):
```powershell
# Local managed server (default behavior)
Remove-Item Env:ELECTRON_NETWORK_SCENARIO -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_REMOTE_API_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_REMOTE_WS_URL -ErrorAction SilentlyContinue
pnpm desktop:dev

# Remote backend
$env:ELECTRON_NETWORK_SCENARIO = "remote"
$env:ELECTRON_LOCAL_SERVER = "0"
$env:ELECTRON_REMOTE_API_BASE_URL = "https://your-remote-domain"
$env:ELECTRON_REMOTE_WS_URL = "wss://your-remote-domain/ws"
pnpm desktop:dev
```

## Common issues
1. `auth schema not initialized: missing table accounts`
   - Run DB scripts in `apps/server/db/` in order.
2. `unauthorized: invalid session token` on `/ws`
   - Login first and ensure client is using current token.
3. Cannot reach client from LAN
   - Vite binds `0.0.0.0:5173`; make sure local firewall allows port `5173`.
