# Desktop Packaging and UI Baseline Plan

This doc defines a practical desktop rollout plan for the current project:

- Runtime shell: Electron
- Priority platform: Windows
- Secondary platform: macOS (reserved path, lower priority)
- UI baseline challenge: current client is mobile-first

---

## 1. Scope and Decision

### 1.1 Current decision

- Use Electron as the desktop runtime shell.
- Ship Windows first.
- Keep macOS build path ready, but do not block release on mac polish.

### 1.2 Is this a big architecture project?

At this stage, it is mostly a build and distribution project, not a full client rewrite.

But it is not "just packaging":

- We must define process boundaries (`main`, `preload`, `renderer`).
- We must define desktop UI behavior (mobile-only layout is not enough on PC).
- We must define release pipeline and security baseline.

So the right level is:

- lightweight architecture doc (this file)
- strong implementation checklist
- avoid over-design

---

## 2. Desktop Runtime Architecture (Electron)

### 2.1 Process model

- `main` process:
  - window lifecycle
  - app menu
  - IPC routing
  - future native integrations
- `preload` process:
  - expose safe APIs into renderer via `contextBridge`
  - never expose raw Node globals
- `renderer` process:
  - existing `apps/h5` app (React + Pixi + Zustand)

### 2.2 Security baseline (must-have)

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` where feasible
- strict IPC allowlist
- no direct `eval`/unsafe remote code paths

### 2.3 Monorepo shape (target)

- `apps/h5`: unchanged web client source
- `apps/desktop`: Electron app
  - `src/main/*`
  - `src/preload/*`
  - packaging config (`electron-builder` or equivalent)

Desktop renderer should consume built assets from `apps/h5/dist`.

---

## 3. UI Strategy: Mobile-First to Desktop

This is the key product issue.

Question: "Separate desktop UI, or one adaptive UI?"

Recommended answer:

- Single codebase
- Dual layout profiles
- Shared game logic/state
- Different presentation tokens and layout maps

Do not fork the whole UI into "mobile app" and "desktop app" yet.

### 3.1 Why not full fork now

- too expensive to maintain
- high risk of behavior drift
- not needed for first desktop release

### 3.2 Why not pure auto-scaling only

- desktop screens waste space with mobile stacking
- action/readability density is suboptimal
- pointer and keyboard interactions are underused

### 3.3 Target model: dual profile

Define two layout profiles:

- `compact` (existing mobile-first behavior)
- `desktop` (wider composition, denser but readable)

Profile selection from runtime viewport metrics:

- stage width
- stage aspect ratio
- input modality hints (pointer precision)

### 3.4 Desktop workspace layout (1920x1080 baseline)

Desktop should reserve left/right rails early to avoid later layout rewrites.

Recommended v1 focus:

- Replay + training (陪练) usability first
- Keep the table renderer in the center viewport
- Use the right rail for Replay controls + REI output (later: coding-agent / custom UI panels)

---

## 4. Implementation Design for UI Profiles

### 4.1 Shared state, separate layout data

Keep all gameplay stores and protocol reducers shared.

Move position/size constants into profile-aware maps:

- Pixi scene layout maps:
  - seat positions
  - board/pot/action panel anchors
  - card scales
- React overlay tokens:
  - spacing
  - font sizes
  - panel widths
  - z-index layers

### 4.2 Minimal contract

Introduce a small UI profile source (store or runtime util):

- `uiProfile: "compact" | "desktop"`
- consumed by scene constructors and overlays

### 4.3 CSS strategy

Use root profile class:

- `.profile-compact`
- `.profile-desktop`

Then bind CSS custom properties by profile:

- panel width
- button size
- modal dimensions
- safe margins

Avoid one-off pixel fixes spread across many files.

### 4.4 Pixi strategy

Avoid hardcoding a single coordinate set in scene files.

Use profile layout tables and apply once during scene init/resize.

---

## 5. Delivery Phases

### Phase 0: Electron scaffold

- create `apps/desktop`
- run desktop dev against local h5 dev server
- run desktop prod against built `apps/h5/dist`

### Phase 1: Windows release path

- package Windows build
- smoke test login/lobby/live/replay flows
- Steam Windows depot integration

### Phase 2: UI profile foundation

- add profile source
- refactor core lobby/table/replay layouts to profile tokens
- keep compact behavior unchanged

### Phase 3: Desktop usability pass

- table readability on 1080p and 1440p
- hover states and pointer targets
- optional keyboard shortcuts for replay/live

### Phase 4: macOS reserved pipeline

- keep build target and config ready
- later enable signing/notarization when capacity allows

---

## 6. Release and Build Notes

Short-term command shape (to implement):

- `pnpm desktop:dev`
- `pnpm desktop:build:win`
- `pnpm desktop:build:mac` (reserved)

Windows is the only required release gate initially.

macOS is "enabled path, optional ship date".

---

## 7. Risks and Guardrails

### Risks

- UI becoming half-mobile half-desktop without clear profile ownership
- IPC sprawl in Electron without permission model
- release scripts drifting from real Steam upload process

### Guardrails

- one profile decision point
- one IPC registry module
- one packaging config source of truth
- one smoke checklist for every desktop build

---

## 8. Final Recommendation

Proceed with Electron now.

Treat desktop as:

- small architecture extension
- medium UI adaptation work
- not a full native rewrite

Execution priority:

1. Windows desktop package and distribution path
2. Dual-profile UI foundation (`compact` + `desktop`)
3. macOS reserved build path when bandwidth exists
