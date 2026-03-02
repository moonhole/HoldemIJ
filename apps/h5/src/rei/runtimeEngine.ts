import { initialLiveSnapshot, reduceLiveMachine, type ReiLiveSnapshot } from './machine/liveMachine';
import { initialReplaySnapshot, reduceReplayMachine, type ReiReplaySnapshot } from './machine/replayMachine';
import type { ReiMachineState, ReiMode, ReiRuntimeInput, ReiStatusTag } from './types';

const REI_MIN_VIEW_HOLD_MS = 1500;

export type ReiRuntimeState = {
    mode: ReiMode;
    machineState: ReiMachineState;
    statusTag: ReiStatusTag;
    keyLine: string;
    details: string;
    updatedAtMs: number;
    liveSnapshot: ReiLiveSnapshot;
    replaySnapshot: ReiReplaySnapshot;
};

function modeFromInput(input: ReiRuntimeInput): ReiMode {
    if (!input.isTableScene) {
        return 'disabled';
    }
    if (input.replayLoaded) {
        return 'replay';
    }
    return 'live';
}

function mapLiveToView(snapshot: ReiLiveSnapshot) {
    return {
        machineState: snapshot.machineState,
        statusTag: snapshot.statusTag,
        keyLine: snapshot.keyLine,
        details: snapshot.details,
    };
}

function mapReplayToView(snapshot: ReiReplaySnapshot) {
    return {
        machineState: snapshot.machineState,
        statusTag: snapshot.statusTag,
        keyLine: snapshot.keyLine,
        details: snapshot.details,
    };
}

function isCriticalStatus(tag: ReiStatusTag): boolean {
    return tag === 'HERO_DECISION' || tag === 'SYNCING' || tag === 'OFFLINE';
}

export function initialReiRuntimeState(nowMs: number = Date.now()): ReiRuntimeState {
    const liveSnapshot = initialLiveSnapshot();
    const replaySnapshot = initialReplaySnapshot();
    return {
        mode: 'disabled',
        machineState: 'disabled',
        statusTag: 'OFFLINE',
        keyLine: 'REI standing by.',
        details: 'Enter table or replay to activate narration.',
        updatedAtMs: nowMs,
        liveSnapshot,
        replaySnapshot,
    };
}

export function reduceReiRuntimeState(prev: ReiRuntimeState, input: ReiRuntimeInput): ReiRuntimeState {
    const nextMode = modeFromInput(input);

    const nextLiveSnapshot = reduceLiveMachine(prev.liveSnapshot, {
        nowMs: input.nowMs,
        isTableScene: input.isTableScene,
        replayLoaded: input.replayLoaded,
        connected: input.connected,
        streamSeq: input.streamSeq,
        lastEvent: input.lastEvent,
        myChair: input.myChair,
        actionPromptChair: input.actionPromptChair,
    });

    const nextReplaySnapshot = reduceReplayMachine(prev.replaySnapshot, {
        nowMs: input.nowMs,
        isTableScene: input.isTableScene,
        replayLoaded: input.replayLoaded,
        streamSeq: input.streamSeq,
        cursor: input.replayCursor,
        stepCount: input.replayStepCount,
        seeking: input.replaySeeking,
        lastEvent: input.lastEvent,
    });

    const active = nextMode === 'replay' ? mapReplayToView(nextReplaySnapshot) : mapLiveToView(nextLiveSnapshot);
    const storyNarration =
        input.storyNarration && input.storyNarration.expiresAtMs > input.nowMs
            ? input.storyNarration
            : null;
    const view = storyNarration
        ? {
            machineState: active.machineState,
            statusTag: storyNarration.statusTag,
            keyLine: storyNarration.keyLine,
            details: storyNarration.details,
        }
        : active;
    const viewChanged =
        prev.machineState !== view.machineState ||
        prev.statusTag !== view.statusTag ||
        prev.keyLine !== view.keyLine ||
        prev.details !== view.details;
    const canHoldView =
        !storyNarration &&
        prev.mode === nextMode &&
        viewChanged &&
        !isCriticalStatus(prev.statusTag) &&
        !isCriticalStatus(view.statusTag) &&
        input.nowMs-prev.updatedAtMs < REI_MIN_VIEW_HOLD_MS;
    const effectiveView = canHoldView
        ? {
            machineState: prev.machineState,
            statusTag: prev.statusTag,
            keyLine: prev.keyLine,
            details: prev.details,
        }
        : view;
    const nextUpdatedAtMs = canHoldView ? prev.updatedAtMs : input.nowMs;

    const liveChanged =
        prev.liveSnapshot.machineState !== nextLiveSnapshot.machineState ||
        prev.liveSnapshot.statusTag !== nextLiveSnapshot.statusTag ||
        prev.liveSnapshot.keyLine !== nextLiveSnapshot.keyLine ||
        prev.liveSnapshot.details !== nextLiveSnapshot.details ||
        prev.liveSnapshot.lastStreamSeq !== nextLiveSnapshot.lastStreamSeq;
    const replayChanged =
        prev.replaySnapshot.machineState !== nextReplaySnapshot.machineState ||
        prev.replaySnapshot.statusTag !== nextReplaySnapshot.statusTag ||
        prev.replaySnapshot.keyLine !== nextReplaySnapshot.keyLine ||
        prev.replaySnapshot.details !== nextReplaySnapshot.details ||
        prev.replaySnapshot.lastCursor !== nextReplaySnapshot.lastCursor ||
        prev.replaySnapshot.lastStreamSeq !== nextReplaySnapshot.lastStreamSeq;

    const changed =
        prev.mode !== nextMode ||
        prev.machineState !== effectiveView.machineState ||
        prev.statusTag !== effectiveView.statusTag ||
        prev.keyLine !== effectiveView.keyLine ||
        prev.details !== effectiveView.details ||
        prev.updatedAtMs !== nextUpdatedAtMs ||
        liveChanged ||
        replayChanged;

    if (!changed) {
        return prev;
    }

    return {
        ...prev,
        mode: nextMode,
        machineState: effectiveView.machineState,
        statusTag: effectiveView.statusTag,
        keyLine: effectiveView.keyLine,
        details: effectiveView.details,
        updatedAtMs: nextUpdatedAtMs,
        liveSnapshot: nextLiveSnapshot,
        replaySnapshot: nextReplaySnapshot,
    };
}
