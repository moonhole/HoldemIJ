import { create } from 'zustand';
import type { GameStreamEvent } from '../store/gameStore';
import { useGameStore } from '../store/gameStore';

export type ReplayTape = {
    tapeVersion: number;
    tableId: string;
    heroChair: number;
    events: GameStreamEvent[];
};

type ReplayMode = 'idle' | 'loaded';

type ReplayState = {
    mode: ReplayMode;
    tape: ReplayTape | null;
    cursor: number;
    loadTape: (tape: ReplayTape) => void;
    clearTape: () => void;
    stepForward: () => void;
    stepBack: () => void;
    seek: (targetCursor: number) => void;
};

function applyTapeToCursor(tape: ReplayTape, targetCursor: number): void {
    const gameStore = useGameStore.getState();
    gameStore.resetForReplay(tape.heroChair);
    for (let i = 0; i <= targetCursor; i++) {
        const ev = tape.events[i];
        if (!ev) break;
        gameStore.ingest(ev);
    }
}

export const useReplayStore = create<ReplayState>((set, get) => ({
    mode: 'idle',
    tape: null,
    cursor: -1,

    loadTape: (tape) => {
        useGameStore.getState().resetForReplay(tape.heroChair);
        set(() => ({
            mode: 'loaded',
            tape,
            cursor: -1,
        }));
    },

    clearTape: () => {
        useGameStore.getState().resetForReplay(-1);
        set(() => ({
            mode: 'idle',
            tape: null,
            cursor: -1,
        }));
    },

    stepForward: () => {
        const state = get();
        if (!state.tape) return;
        const nextCursor = Math.min(state.cursor + 1, state.tape.events.length - 1);
        if (nextCursor === state.cursor || nextCursor < 0) return;
        useGameStore.getState().ingest(state.tape.events[nextCursor]);
        set(() => ({ cursor: nextCursor }));
    },

    stepBack: () => {
        const state = get();
        if (!state.tape) return;
        const nextCursor = Math.max(-1, state.cursor - 1);
        applyTapeToCursor(state.tape, nextCursor);
        set(() => ({ cursor: nextCursor }));
    },

    seek: (targetCursor) => {
        const state = get();
        if (!state.tape) return;
        const clamped = Math.max(-1, Math.min(targetCursor, state.tape.events.length - 1));
        applyTapeToCursor(state.tape, clamped);
        set(() => ({ cursor: clamped }));
    },
}));

