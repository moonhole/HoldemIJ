import { create } from 'zustand';
import { initialLiveSnapshot, reduceLiveMachine, type ReiLiveSnapshot } from './machine/liveMachine';
import { initialReplaySnapshot, reduceReplayMachine, type ReiReplaySnapshot } from './machine/replayMachine';
import type { ReiMachineState, ReiMode, ReiRuntimeInput, ReiStatusTag } from './types';

type ReiStoreState = {
    mode: ReiMode;
    machineState: ReiMachineState;
    statusTag: ReiStatusTag;
    keyLine: string;
    details: string;
    updatedAtMs: number;
    liveSnapshot: ReiLiveSnapshot;
    replaySnapshot: ReiReplaySnapshot;
    tick: (input: ReiRuntimeInput) => void;
    reset: () => void;
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

export const useReiStore = create<ReiStoreState>((set, get) => ({
    mode: 'disabled',
    machineState: 'disabled',
    statusTag: 'OFFLINE',
    keyLine: 'REI standing by.',
    details: 'Enter table or replay to activate narration.',
    updatedAtMs: Date.now(),
    liveSnapshot: initialLiveSnapshot(),
    replaySnapshot: initialReplaySnapshot(),

    tick: (input) => {
        const prev = get();
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
            lastEvent: input.lastEvent,
        });

        const active = nextMode === 'replay' ? mapReplayToView(nextReplaySnapshot) : mapLiveToView(nextLiveSnapshot);

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
            prev.machineState !== active.machineState ||
            prev.statusTag !== active.statusTag ||
            prev.keyLine !== active.keyLine ||
            prev.details !== active.details ||
            liveChanged ||
            replayChanged;

        if (!changed) {
            return;
        }

        set(() => ({
            mode: nextMode,
            machineState: active.machineState,
            statusTag: active.statusTag,
            keyLine: active.keyLine,
            details: active.details,
            updatedAtMs: input.nowMs,
            liveSnapshot: nextLiveSnapshot,
            replaySnapshot: nextReplaySnapshot,
        }));
    },

    reset: () =>
        set(() => {
            const liveSnapshot = initialLiveSnapshot();
            const replaySnapshot = initialReplaySnapshot();
            return {
                mode: 'disabled',
                machineState: 'disabled',
                statusTag: 'OFFLINE',
                keyLine: liveSnapshot.keyLine,
                details: liveSnapshot.details,
                updatedAtMs: Date.now(),
                liveSnapshot,
                replaySnapshot,
            };
        }),
}));
