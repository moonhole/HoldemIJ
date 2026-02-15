import { create } from 'zustand';
import { initialReiRuntimeState, reduceReiRuntimeState, type ReiRuntimeState } from './runtimeEngine';
import type { ReiRuntimeInput } from './types';

type ReiStoreState = ReiRuntimeState & {
    tick: (input: ReiRuntimeInput) => void;
    applyRuntimeState: (next: ReiRuntimeState) => void;
    reset: () => void;
};

function runtimeSlice(state: ReiStoreState): ReiRuntimeState {
    return {
        mode: state.mode,
        machineState: state.machineState,
        statusTag: state.statusTag,
        keyLine: state.keyLine,
        details: state.details,
        updatedAtMs: state.updatedAtMs,
        liveSnapshot: state.liveSnapshot,
        replaySnapshot: state.replaySnapshot,
    };
}

function hasRuntimeChanged(prev: ReiRuntimeState, next: ReiRuntimeState): boolean {
    return (
        prev.mode !== next.mode ||
        prev.machineState !== next.machineState ||
        prev.statusTag !== next.statusTag ||
        prev.keyLine !== next.keyLine ||
        prev.details !== next.details ||
        prev.updatedAtMs !== next.updatedAtMs ||
        prev.liveSnapshot.machineState !== next.liveSnapshot.machineState ||
        prev.liveSnapshot.statusTag !== next.liveSnapshot.statusTag ||
        prev.liveSnapshot.keyLine !== next.liveSnapshot.keyLine ||
        prev.liveSnapshot.details !== next.liveSnapshot.details ||
        prev.liveSnapshot.lastStreamSeq !== next.liveSnapshot.lastStreamSeq ||
        prev.replaySnapshot.machineState !== next.replaySnapshot.machineState ||
        prev.replaySnapshot.statusTag !== next.replaySnapshot.statusTag ||
        prev.replaySnapshot.keyLine !== next.replaySnapshot.keyLine ||
        prev.replaySnapshot.details !== next.replaySnapshot.details ||
        prev.replaySnapshot.lastCursor !== next.replaySnapshot.lastCursor ||
        prev.replaySnapshot.lastStreamSeq !== next.replaySnapshot.lastStreamSeq
    );
}

export const useReiStore = create<ReiStoreState>((set) => ({
    ...initialReiRuntimeState(),

    tick: (input) => {
        set((state) => {
            const prevRuntime = runtimeSlice(state);
            const nextRuntime = reduceReiRuntimeState(prevRuntime, input);
            if (nextRuntime === prevRuntime) {
                return state;
            }
            return {
                ...state,
                ...nextRuntime,
            };
        });
    },

    applyRuntimeState: (next) =>
        set((state) => {
            const prevRuntime = runtimeSlice(state);
            if (!hasRuntimeChanged(prevRuntime, next)) {
                return state;
            }
            return {
                ...state,
                ...next,
            };
        }),

    reset: () => set((state) => ({ ...state, ...initialReiRuntimeState() })),
}));
