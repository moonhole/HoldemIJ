# Replay (Local WASM) Design

This doc describes a minimal, shippable design for:

- User provides a *structured* hand description (`HandSpec`).
- The client runs the poker engine locally (WASM) to reproduce the hand.
- The client can step forward/backward, seek, and branch "what-if" lines.
- A "REI Lite" narrator can explain based on deterministic game state (no LLM required).

Target: NLH only (Texas Hold'em No-Limit), single-hand replay/analysis.

Naming in this doc follows `audit.md`:

- `ledger`: internal append-only fact stream core.
- `audit`: product experience for history query/review.
- `sandbox`: product experience for branch simulation.

See also:

- `agent.md` (HandSpecBuilder, Director, BotPolicy)
- `rei.md` (REI narration layer consuming replay/live context)
- `audit.md` (Audit Product + Ledger Core)

---

## Goals

- Deterministic replay: same `HandSpec` => same replay tape.
- No server required for replay: offline-friendly, low latency.
- Reuse existing client rendering/event reducers: the replay output should look like the live server stream.
- Support step/seek/back with good UX (timeline).
- Provide a clean seam for later "LLM -> HandSpec" (optional).

## Non-Goals (MVP)

- Solver-grade GTO / range enumeration.
- Real-time assistance for live money platforms.
- Full multi-hand session importing (can be later).

---

## Core Idea

Model replay as **event sourcing**:

1. `HandSpec` defines the initial conditions and the intended actions.
2. The engine re-simulates the hand, producing a `ReplayTape` (ordered event list).
3. The UI is a pure consumer: it plays the tape forward, and to go backward it replays up to an earlier index.

This fits the existing client architecture:

- Live mode: WebSocket -> `ServerEnvelope` -> store reducers -> Pixi + UI.
- Replay mode: `ReplayTape` -> same store reducers -> Pixi + UI.

System role:

- Replay is the deterministic simulation and timeline engine.
- Replay does not define persistence policy by itself.
- If persistence is needed, replay outputs are appended into `ledger` and then consumed by product projections (`audit` / `sandbox`).

---

## Data Model

### HandSpec v1 (JSON)

`HandSpec` is the *only* input needed for replay. Everything else is derived.

Key design choices:

- Actions use "amount_to" semantics (total bet size this round), matching the existing protocol (`ActionRequest.amount`).
- Determinism is provided by:
  - explicit `dealer_chair`, and
  - either a full `deck` order OR a `seed` + partial constraints (hole/board).

Example (minimal):

```json
{
  "variant": "NLH",
  "table": { "max_players": 6, "sb": 50, "bb": 100, "ante": 0 },
  "dealer_chair": 3,
  "seats": [
    { "chair": 0, "name": "YOU", "stack": 11000, "is_hero": true, "hole": ["Js", "Qc"] },
    { "chair": 2, "name": "P1", "stack": 8000 },
    { "chair": 4, "name": "P2", "stack": 12000 }
  ],
  "board": { "flop": ["Ah", "7d", "2c"], "turn": null, "river": null },
  "actions": [
    { "phase": "PREFLOP", "chair": 2, "type": "RAISE", "amount_to": 300 },
    { "phase": "PREFLOP", "chair": 4, "type": "CALL",  "amount_to": 300 },
    { "phase": "PREFLOP", "chair": 0, "type": "CALL",  "amount_to": 300 },
    { "phase": "FLOP",    "chair": 4, "type": "BET",   "amount_to": 450 },
    { "phase": "FLOP",    "chair": 0, "type": "FOLD",  "amount_to": 0 }
  ],
  "rng": { "seed": 123456789 }
}
```

Card encoding (string):

- Ranks: `2 3 4 5 6 7 8 9 T J Q K A`
- Suits: `s h c d`
- Example: `As`, `Td`, `7h`, `2c`

Recommended schema (v1):

- `variant`: fixed `NLH`
- `table`: `max_players`, `sb`, `bb`, `ante`
- `dealer_chair`: explicit dealer/button for determinism
- `seats[]`: `chair`, `stack`, optional `name`, optional `is_hero`, optional `hole[2]`
- `board`: optional `flop[3]`, optional `turn[1]`, optional `river[1]`
- `deck`: optional full 52-card order (strongest determinism)
- `rng.seed`: optional (used if `deck` not provided)
- `actions[]`: ordered; each action includes `phase`, `chair`, `type`, `amount_to`

Validation rules (must fail fast with structured errors):

- Chairs are unique and in range `[0, max_players)`.
- At least 2 active seats with stack > 0.
- No duplicate cards across hole/board/deck constraints.
- Action sequence is legal under engine rules (or return error with context).

### ReplayTape v1

`ReplayTape` is a linear list of events that the client can ingest.

Two viable encodings:

1. **pb-compatible events** (best reuse): store a list of `ServerEnvelope` payloads.
2. **JSON events**: a simplified union mirroring `GameStreamEvent` in `apps/h5/src/store/gameStore.ts`.

MVP recommendation:

- Use **JSON event union**, shaped like the existing store expects, to avoid protobuf-in-WASM friction.
- Keep a path to "pb binary" later if needed (smaller payloads).

Example `ReplayTape` (JSON):

```json
{
  "tape_version": 1,
  "table_id": "replay_local",
  "events": [
    { "type": "snapshot", "value": { "...": "TableSnapshot-like JSON" } },
    { "type": "handStart", "value": { "...": "HandStart-like JSON" } },
    { "type": "holeCards", "value": { "...": "DealHoleCards-like JSON (hero only)" } },
    { "type": "actionResult", "value": { "...": "ActionResult-like JSON" } },
    { "type": "phaseChange", "value": { "...": "PhaseChange-like JSON" } },
    { "type": "handEnd", "value": { "...": "HandEnd-like JSON" } }
  ]
}
```

Important: The *shape* should match what the store reduces today (snapshot/handStart/holeCards/board/potUpdate/phaseChange/actionResult/...).

Persistence note:

- `ReplayTape` is runtime transport for playback.
- Persisted source of truth is `ledger_event_stream` (see `audit.md`), keyed by `source + scenario_id + hand_id + seq`.

### ReplayError

When replay generation fails (illegal action / missing info), return:

- `step_index`: which action failed
- `reason`: machine-readable code
- `message`: user-friendly summary
- `expected`: optional legal actions + min raise/call amounts at that point

This is the hook for later "clarifying questions".

---

## Engine Requirements (Minimal Changes)

Today the Go engine (`holdem.Game`) internally shuffles and selects dealer randomly on first hand.

For deterministic replay, we need:

1. Forced dealer/button:
   - Add `StartHandWithDealer(dealerChair uint16)` OR extend config with optional `DealerChair`.
2. Deterministic deck:
   - Option A: full `deck` order provided (52 cards).
   - Option B: `seed` provided + partial constraints (hole/board); engine constructs a deck that satisfies constraints deterministically.
3. Scripted dealing (optional but recommended):
   - If `HandSpec` includes `hole` and/or `board`, the engine must ensure those exact cards appear.

Implementation sketch:

- Extend `holdem.Config` with:
  - `Seed int64` (already exists)
  - `ForcedDealerChair *uint16` (optional)
  - `DeckOverride []card.Card` (optional full order)
  - `DealConstraints` (optional: fixed hole/board)

MVP compromise:

- Support either:
  - full `deck` OR
  - `seed` with no fixed cards
- Add fixed cards later.

But for "user described one hand", fixed cards are a big value add, so it is worth adding early.

---

## Replay Generation (Go -> WASM)

### Approach A (Recommended): Build a ReplayTape generator in Go

Create a deterministic runner that:

1. Creates a `holdem.Game` with forced dealer/deck settings.
2. Seats players with stacks.
3. Starts a hand and applies actions in order.
4. Emits events after each mutation.

Event emission strategy:

- Reuse the existing server event semantics:
  - `HandStart`, `DealHoleCards`, `ActionResult`, `DealBoard`, `PhaseChange`, `PotUpdate`, `HandEnd`...
- The runner should build the same event shapes as the client store consumes.

Key rule: the replay runner is synchronous (no timers, no goroutines), so it can run inside a WASM worker reliably.

### WASM boundary API

In a WebWorker:

- `init(spec: HandSpec): ReplayInitResult`
  - returns `ReplayTape` OR `ReplayError`
- `branch(spec: HandSpec, branchAt: number, overrideAction: ActionSpec): ReplayInitResult`
  - recompute from a modified line (what-if)

When branch output should be retained:

- `audit` flow: append retained replay lines to `ledger` with `source=replay`.
- `sandbox` flow: append branch lines to `ledger` with `source=sandbox` and a unique `scenario_id`.

Why recompute instead of "incremental stepping in WASM":

- A single hand is small; recompute cost is low.
- UI stepping should be instant and independent of WASM calls.

### Build/packaging

The client app is already Vite-based (`apps/h5`).

Add a build target:

- `GOOS=js GOARCH=wasm` produces `holdem_replay.wasm`
- The worker loads WASM + `wasm_exec.js`

Notes:

- Run WASM inside a Worker to keep the UI smooth.
- Keep the JSON interface small and stable.

---

## Client Playback

### Adapter: ReplayClient

Introduce a local "transport" that mirrors the live `GameClient` callbacks:

- Live: WebSocket stream -> `onSnapshot/onActionResult/...`
- Replay: `ReplayTape.events` -> same callbacks

This lets us reuse:

- `apps/h5/src/store/gameStore.ts` reducers
- Pixi table renderer + UI overlays

### Step / Back / Seek

Maintain:

- `tape: ReplayTape`
- `cursor: number` (event index)

Operations:

- `reset()`: clear store state, set cursor = 0
- `applyTo(i)`: reset, then ingest events `[0..i]`
- `stepForward()`: cursor++, ingest next event
- `stepBack()`: cursor--, `applyTo(cursor)`

MVP performance is fine (per-hand events are small). If needed later:

- checkpoint snapshots every N events to accelerate seek.

### Branching (What-if)

At a chosen `cursor`:

- Let user override the next action (hero only, or any seat).
- Call WASM `branch(...)` to regenerate a new tape starting from the same initial conditions with altered action line.
- UI treats it as a new tape with a parent pointer for navigation (optional).
- Persisting a branch is optional and policy-driven by product layer (`audit` vs `sandbox`).

---

## REI Lite Narration (No LLM)

MVP narrator should be deterministic and strongly state-bound:

Inputs:

- latest snapshot + last event
- hero chair + phase + pot + bets + action legality (call/minraise)
- optional opponent "persona" tags (loose-passive, etc.)

Outputs:

- 1 short "key point" line (always)
- optional "details" block (expandable)

Implementation:

- Template library + rule engine in TS (cheap, easy to iterate).
- Later, subscription tier replaces/extends this with LLM output.

Boundary with ledger/audit:

- Replay provides factual timeline and state transitions.
- REI provides explanation text.
- Audit UI may show factual step text without REI; REI remains optional overlay.

---

## Minimal Milestones

1. Define `HandSpec v1` + validation + examples.
2. Implement Go replay runner that produces `ReplayTape` JSON.
3. Compile replay runner to WASM and call it from a Worker.
4. Implement `ReplayClient` adapter and a simple timeline UI (step/back/play).
5. Add REI Lite templates bound to (event + snapshot).

---

## Key Risks / Tradeoffs

- Go WASM size/cold start: mitigate by Worker + lazy load + caching.
- Determinism pitfalls:
  - avoid `time.Now()` in replay logic
  - define deck/seed/dealer explicitly
- Protobuf in WASM: JSON first, pb later if needed.
