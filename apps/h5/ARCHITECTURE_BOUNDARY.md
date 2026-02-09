# React / Pixi Boundary

This document defines the ownership boundary for the next client architecture stage.

## Goal

- React owns business UI and interaction flow.
- Pixi owns table rendering and animation only.

## Ownership

### React owns

- Navigation and page-level flow (`boot`, `lobby`, `table` route/state).
- Business UI components:
  - login/profile
  - table list / quick start
  - buy-in modal
  - action buttons, bet slider, timers
  - settings / chat / toasts
- User intents and command dispatch (`join`, `sitDown`, `check/call/raise/fold/allin`).
- Domain state/store (snapshot + event reduction).

### Pixi owns

- Table canvas rendering:
  - felt, seats, avatars
  - hole cards, community cards
  - chips, pots
- Visual effects and animation timeline:
  - dealing
  - chip fly / pot collection
  - showdown reveal
  - winner highlight
- Resize and viewport adaptation for canvas scene.

## Forbidden dependencies

- `src/pixi/**` must not import:
  - `network/GameClient`
  - React UI code
  - business command handlers
- `src/ui/**` (future React layer) must not:
  - mutate Pixi internals directly
  - call scene object methods directly for business actions

## Communication contracts

All cross-layer communication goes through contracts in:

- `src/architecture/contracts.ts`
- `src/architecture/boundary.ts`
- Runtime state hub: `src/store/gameStore.ts` (zustand)

Flow:

1. Gateway messages -> store (domain state).
2. Store -> `TableRendererPort.render()` for deterministic canvas state.
3. Store -> React components for business UI.
4. React action -> `UiIntent` -> `GameCommandPort` -> transport adapter.
5. Optional visual timeline -> `TableRendererPort.animate()` from reduced events.

## DOM mount points

- Pixi canvas root: `#game-canvas`
- React UI root: `#ui-layer`

These ids are declared in `src/architecture/boundary.ts`.

## Current code status

- Current `TableScene` still contains temporary business controls.
- This boundary is now defined and codified by contracts.
- Next step is extraction:
  1. Move action panel/buy-in controls from Pixi to React UI.
  2. Keep only visual hints in Pixi.
  3. Route all player actions through `UiIntent`.
