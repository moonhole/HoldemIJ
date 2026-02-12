# Mobile Distribution Plan (Scope: 1/2 Only)

This document only covers the two approved channels:

1. Browser / PWA
2. Store-distributed shell app (Android + iOS)

Explicitly out of scope for now:

- 3. Private enterprise distribution
- 4. iOS alternative marketplaces

---

## 1. Goal and Constraints

### Product goal

- Ship mobile access quickly.
- Keep one gameplay codebase.
- Avoid blocking core iteration speed.

### Engineering constraints

- Current client is H5 (React + Pixi + Zustand), mobile-first.
- Team focus is still desktop + core gameplay iteration.
- Mobile work must be incremental, not a rewrite.

---

## 2. Recommended Strategy

Use a two-lane strategy:

- Lane A (baseline): Browser/PWA as universal fallback.
- Lane B (growth): Store shell app for better installability and channel reach.

Key principle:

- `apps/h5` remains the single renderer source of truth.
- PWA and shell both consume the same web UI/runtime.

---

## 3. Lane A: Browser / PWA

### Why this lane

- Fastest release and update cycle.
- Lowest operational complexity.
- Always-available fallback when store review is delayed.

### Must-have implementation

- Web app manifest (name, icons, display mode, theme color).
- Service worker with safe caching strategy.
- Stable versioning and cache invalidation policy.
- Mobile-safe viewport behavior and touch interaction QA.
- Runtime environment switch (prod/staging API endpoints).

### Acceptance criteria

- "Add to Home Screen" works on major mobile browsers.
- App can cold-start with cached shell assets.
- Login/lobby/live/replay flows are stable on mid-range devices.

---

## 4. Lane B: Store Shell App

### Positioning

- Same game UI core, app-store delivery channel.
- Adds install confidence, notifications/native hooks later, and better user acquisition paths.

### Android path (first)

- Start with lightweight shell packaging.
- Prefer minimal native surface at first release.
- Add native capabilities only when product requires them.

### iOS path (second)

- Package with WebView-based shell approach.
- Add enough app-level integration to avoid looking like a pure website wrapper.
- Keep first iOS milestone small: login/lobby/table/replay parity and stable session behavior.

### Shell app must-have checklist

- App lifecycle handling (background/foreground/resume).
- Session persistence and secure token storage policy.
- Network interruption/reconnect behavior.
- Crash and fatal error logging.
- Update and version compatibility strategy.

---

## 5. Shared Architecture Rules (PWA + Shell)

### Single-source UI rule

- Do not fork gameplay UI by channel.
- Use profile/tokens for layout differences.

### Runtime capability boundary

- Define a small capability layer:
  - browser capability set
  - shell capability set
- Game features query capability flags, not platform strings.

### Security baseline

- Minimize token exposure surface.
- Avoid direct dependence on insecure browser storage patterns in shell mode.
- Keep auth flow behavior identical across channels.

---

## 6. Delivery Phases

### Phase 0: PWA hardening

- Finalize manifest + service worker + cache strategy.
- Run device matrix QA for core flows.

### Phase 1: Android shell release

- Build/store pipeline, signing, release track.
- Production crash monitoring and rollout guardrails.

### Phase 2: iOS shell release

- Packaging + signing + review readiness.
- Ensure parity with Android/PWA core gameplay flows.

---

## 7. Risks and Mitigations

### Risk: "one codebase" drifts into platform branches

- Mitigation: enforce capability abstraction and shared UI modules.

### Risk: mobile performance regressions due to desktop-facing changes

- Mitigation: keep mobile profile as first-class CI smoke target.

### Risk: shell app review delays

- Mitigation: keep PWA as always-on distribution fallback.

---

## 8. Current Decision Summary

Approved and active:

- Browser/PWA
- Store shell app (Android first, iOS follow-up)

Deferred:

- Private enterprise channels
- Alternative marketplace channels

