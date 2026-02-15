# Desktop Frame Stability Roadmap

This document defines the iteration plan for desktop frame-rate stability on the current Electron + React + Pixi stack.

## 1. Background

Current symptoms:
- Frame rate usually stays near refresh-rate ceiling (commonly 60 FPS), but intermittent frame drops are visible.
- Renderer, UI logic, and state-driven auxiliary logic share the same main thread in the renderer process.

Current architecture hotspots (from existing code):
- REI runtime ticks on multiple store subscriptions: `apps/h5/src/rei/runtime.ts`
- Duplicate countdown loops (`setInterval(100)` in both Pixi and React overlay):
  - `apps/h5/src/scenes/TableScene.ts`
  - `apps/h5/src/ui/actions/ActionOverlay.tsx`
- Fixed render resolution cap without runtime quality adaptation:
  - `apps/h5/src/main.ts`

## 2. Goals and Success Criteria

Primary goal:
- Improve frame pacing stability first (P95/P99), not just average FPS.

Release-level acceptance targets (desktop 1080p baseline):
- `frameMsAvg <= 18 ms`
- `frameMsP95 <= 24 ms`
- `frameMsMax <= 50 ms` during normal gameplay (excluding initial load/scene switch)
- `longFrames` trend reduced by at least 40% vs baseline

Secondary goals:
- Avoid noticeable UI behavior regressions.
- Keep architecture evolvable toward render-thread separation if needed.

## 3. Constraints and Non-goals

Constraints:
- Keep current product architecture (Electron renderer hosts H5 app) for near-term iterations.
- Avoid high-risk rewrite before measurable gains from low-risk work.

Non-goals (for this roadmap):
- Immediate full migration to a separate render process.
- Simultaneous feature expansion while doing perf refactors.

## 4. Iteration Strategy (1 -> 2 -> 3 -> 4)

Principle:
- Execute low-risk/high-ROI work first (`1/2/3`), and gate `4` with data.

### Phase 0: Baseline and Observability

Scope:
- Establish repeatable perf baselines before optimization.

Tasks:
- Define benchmark scenarios:
  - Lobby idle
  - Table active hand (normal action frequency)
  - Showdown-heavy sequence
- Capture metrics from existing perf overlay pipeline:
  - FPS, frame avg/P95/max, render avg, drawCalls, longFrames
- Add simple runbook for measuring before/after each phase.

Acceptance:
- A reproducible baseline sheet exists for at least 3 representative scenes.

Rollback:
- None (measurement only).

### Phase 1: Workerize Non-render Computation

Scope:
- Move non-render heavy work off renderer main thread, starting with REI/runtime evaluation path.

Tasks:
- Introduce dedicated worker for REI/runtime calculation.
- Replace per-store-change immediate execution with throttled message batching (target 30 Hz for analysis path).
- Keep rendering and user actions on current thread.

Files likely touched:
- `apps/h5/src/rei/runtime.ts`
- `apps/h5/src/rei/*`
- New worker entry under `apps/h5/src/rei/` or `apps/h5/src/workers/`

Acceptance:
- No behavior change in REI user-facing outputs.
- Measurable reduction in long-frame spikes during action bursts.

Rollback:
- Feature flag to switch REI path back to in-thread execution.

### Phase 2: Unify Timing Sources (Single Clock)

Scope:
- Remove duplicated timers and align time-based updates to one authoritative clock.

Tasks:
- Consolidate countdown updates currently driven in both Pixi and React.
- Prefer one frame-aligned schedule path (`requestAnimationFrame`-driven or single scheduler).
- Ensure all countdown displays consume the same computed source-of-truth values.

Files likely touched:
- `apps/h5/src/scenes/TableScene.ts`
- `apps/h5/src/ui/actions/ActionOverlay.tsx`
- Optional shared timer utility module

Acceptance:
- Countdown behavior remains correct.
- Timer-driven jitter and unnecessary re-render churn reduced.

Rollback:
- Keep old dual-path behind temporary compatibility switch until validated.

### Phase 3: Dynamic Quality Control (Adaptive DPR)

Scope:
- Introduce runtime quality adaptation to trade visual fidelity for frame stability under load.

Tasks:
- Add simple quality manager based on recent frame history.
- Start with conservative levels:
  - High: DPR 2.0
  - Medium: DPR 1.5
  - Low: DPR 1.25 or 1.0
- Downshift when sustained long frames exceed threshold; recover gradually when stable.

Files likely touched:
- `apps/h5/src/main.ts`
- New perf/quality policy module

Acceptance:
- Significant P95 improvement under stress scenes.
- No severe visual artifacts during quality transitions.

Rollback:
- Runtime flag to lock fixed DPR.

### Phase 4 (Conditional): Render Thread Separation (OffscreenCanvas Worker)

Scope:
- Move Pixi rendering to worker-backed OffscreenCanvas when `1/2/3` are insufficient.

When to enter Phase 4:
- After Phase 3, release targets still fail in representative hardware tiers.
- Bottleneck remains render/main-thread contention despite prior optimizations.

Tasks:
- Validate Pixi + OffscreenCanvas compatibility in target Electron version.
- Define strict message protocol between UI/store thread and render worker:
  - State snapshots or reduced render commands
  - Animation/event cues
- Isolate side effects and remove direct cross-layer mutable access.

Risks:
- High integration complexity and debugging cost.
- Tooling/dev experience complexity rises.
- Potential incompatibility around plugins/features.

Acceptance:
- Clear stability gain over Phase 3 baseline on target hardware.
- No major regressions in interaction latency or correctness.

Rollback:
- Keep in-thread renderer path as fallback build/runtime option until fully proven.

## 5. Milestones (Suggested)

Recommended cadence:
- M0 (1 week): Phase 0 completed, baseline report signed off
- M1 (1-2 weeks): Phase 1 delivered behind flag, validated
- M2 (1 week): Phase 2 delivered, old timer path removed after soak
- M3 (1 week): Phase 3 delivered with tuning pass
- M4 decision gate: Evaluate whether Phase 4 is still required

## 6. Decision Gate for Phase 4

Proceed to Phase 4 only if all are true:
- Targets in section 2 are still unmet after Phase 3.
- Profiling confirms remaining dominant cost is render-thread contention.
- Team accepts higher complexity and longer stabilization window.

Otherwise:
- Continue tuning Phase 1-3 policies and content complexity.

## 7. Tracking Template (Per Phase)

For each phase, record:
- Baseline metrics (before)
- Implementation summary
- Metrics (after)
- Regression checks
- Decision: keep / tune / rollback

