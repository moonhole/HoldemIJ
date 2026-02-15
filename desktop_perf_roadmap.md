# Desktop Frame Stability and Resource Efficiency Roadmap

This document defines the iteration plan for desktop frame-rate stability and CPU/GPU efficiency on the current Electron + React + Pixi stack.

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
- Keep CPU/GPU usage low enough for commercial desktop quality expectations (no obvious fan-noise issues in idle scenes).

## 2.1 Commercial Runtime Resource Budget

These budgets are release gates for production builds (`desktop:build:*`), not dev mode (`desktop:dev`).

### CPU budget

- Idle (lobby/table idle, no interaction for 30s):
  - Renderer process CPU median <= 8%
  - Renderer process CPU P95 <= 14%
- Active hand (normal action sequence):
  - Renderer process CPU median <= 35%
  - Renderer process CPU P95 <= 55%

### GPU budget

- Idle (same scenario):
  - GPU utilization median <= 18%
- Active hand:
  - GPU utilization median <= 60%
  - GPU utilization P95 <= 80%

### Thermal/product quality proxy

- On baseline QA laptop/desktop, idle scenario must not trigger sustained high fan state after warm-up.
- If this subjective check fails, the build does not pass release gate even when FPS targets pass.

## 2.2 Measurement Protocol

To keep numbers comparable, all phases use the same protocol:

- Build target: production desktop bundle.
- Window mode: visible foreground, 1080p baseline.
- Sample window: 3 minutes per scenario.
- Scenarios:
  - Lobby idle
  - Table idle
  - Table active hand
  - Showdown-heavy sequence
- Metrics captured:
  - FPS metrics (existing perf overlay pipeline)
  - CPU/GPU process utilization (OS tools + Electron process view)
- Reporting:
  - median, P95, max
  - before/after delta by phase

## 2.3 Phase Status Ledger

Use this table as the single source of truth for phase progress and evidence.

| Phase | Status | Evidence | Gate |
|---|---|---|---|
| Phase 0 (Baseline) | Backfilling | Perf overlay capability exists (`95b7ea2`), baseline report pending | Not passed |
| Phase 1 (Workerize non-render) | Delivered | REI worker + 30Hz throttling (`bb7a97e`) | Conditionally passed (pending full protocol run) |
| Phase 2 (Single clock) | Not started | N/A | Not passed |
| Phase 3 (Adaptive DPR) | Not started | N/A | Not passed |
| Phase 4 (Conditional) | Not started | N/A | Not entered |

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
- Capture CPU/GPU occupancy with the protocol in section 2.2.
- Add simple runbook for measuring before/after each phase.

Phase 0 backfill tasks (required now):
- Convert current ad-hoc observations into a repeatable baseline record.
- Record hardware + build info for every sample row.
- Freeze one baseline commit reference for comparison against future phases.

Acceptance:
- A reproducible baseline sheet exists for at least 3 representative scenes.
- Baseline includes both frame metrics and CPU/GPU occupancy metrics.

Backfill checklist:
- [x] Observability capability in codebase (perf overlay) confirmed.
- [x] Phase status ledger established in this roadmap.
- [ ] Baseline runbook executed for all required scenarios.
- [ ] Baseline metrics table completed and reviewed.
- [ ] Baseline commit/tag selected as comparison anchor.

### Phase 0 Runbook (Single-doc Version)

For each benchmark run, append one row to the baseline table below.

1. Build/setup:
   - Use production-capable path (not hot-reload dev metrics as release gate).
   - Record git commit hash.
2. Warm-up:
   - Open target scene and wait 60s before sampling.
3. Sample:
   - Collect 3 minutes per scenario.
   - Collect FPS/frame metrics from in-app overlay.
   - Collect renderer CPU and GPU utilization from OS/process tooling.
4. Record:
   - Fill median/P95/max values.
   - Note anomalies (stutters, fan spikes, throttling signs).
5. Review:
   - Mark pass/fail against section 2 and 2.1 budgets.

### Phase 0 Baseline Table

Fill this in-place (do not create extra phase docs unless raw data is too large).

| Date | Commit | Build Mode | Hardware Tier | Scenario | FPS Avg | Frame P95 (ms) | Long Frames | CPU Median | CPU P95 | GPU Median | GPU P95 | Fan/thermal notes |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 2026-02-15 | bb7a97e | desktop dev (non-gate) | TBD | Table active hand | ~40+ floor observed | TBD | TBD | TBD | TBD | TBD | TBD | User reported floor improved after Phase 1 |
| TBD | TBD | production gate run | Tier A | Lobby idle | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| TBD | TBD | production gate run | Tier A | Table idle | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| TBD | TBD | production gate run | Tier A | Table active hand | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| TBD | TBD | production gate run | Tier A | Showdown-heavy | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

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
- Measurable renderer CPU reduction in idle table and active hand scenarios.
- No CPU regression in lobby idle scenario.

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
- Timer wakeups and idle CPU usage reduced versus Phase 1 baseline.
- No increase in GPU usage due to timer refactor.

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
- GPU utilization reduction under active/stress scenarios.
- Resource budget pass rate improves on lower-end QA hardware tier.

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
- Resource budget in section 2.1 is still unmet after Phase 3.
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
