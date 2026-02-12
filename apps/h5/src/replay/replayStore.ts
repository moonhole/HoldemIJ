import { create } from 'zustand';
import type { GameStreamEvent } from '../store/gameStore';
import { useGameStore } from '../store/gameStore';
import { Phase, type ActionPrompt, type Card, type DealBoard, type PhaseChange, type Pot, type PotUpdate, type TableSnapshot } from '@gen/messages_pb';

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
    isSeeking: boolean;
    silentFx: boolean;
    // Visual cursor index (compressed steps), -1 means before first event.
    cursor: number;
    // Maps visual cursor -> raw event index in tape.events.
    visualSteps: number[];
    loadTape: (tape: ReplayTape) => void;
    clearTape: () => void;
    stepForward: () => void;
    stepBack: () => void;
    seek: (targetCursor: number) => void;
    beginSeek: () => void;
    endSeek: () => void;
};

function applyTapeToRawCursor(tape: ReplayTape, targetRawCursor: number): void {
    const gameStore = useGameStore.getState();
    gameStore.resetForReplay(tape.heroChair);
    for (let i = 0; i <= targetRawCursor; i++) {
        const ev = tape.events[i];
        if (!ev) break;
        gameStore.ingest(ev);
    }
}

function actionPromptSignature(prompt: ActionPrompt): string {
    return [
        prompt.chair,
        prompt.minRaiseTo.toString(),
        prompt.callAmount.toString(),
        prompt.legalActions.join(','),
    ].join('|');
}

type VisualProjection = {
    hasPhase: boolean;
    phase: number;
    hasBoard: boolean;
    boardSig: string;
    hasPots: boolean;
    potsSig: string;
};

function createVisualProjection(): VisualProjection {
    return {
        hasPhase: false,
        phase: 0,
        hasBoard: false,
        boardSig: '',
        hasPots: false,
        potsSig: '',
    };
}

function cardSignature(card: Card): string {
    return `${card.suit}:${card.rank}`;
}

function cardsSignature(cards: Card[]): string {
    return cards.map(cardSignature).join(',');
}

function potsSignature(pots: Pot[]): string {
    return pots.map((pot) => `${pot.amount.toString()}|${pot.eligibleChairs.join(',')}`).join(';');
}

function projectSnapshot(projection: VisualProjection, snapshot: TableSnapshot): void {
    projection.hasPhase = true;
    projection.phase = snapshot.phase;
    projection.hasBoard = true;
    projection.boardSig = cardsSignature(snapshot.communityCards);
    projection.hasPots = true;
    projection.potsSig = potsSignature(snapshot.pots);
}

function projectHandStart(projection: VisualProjection): void {
    projection.hasBoard = true;
    projection.boardSig = '';
    projection.hasPots = true;
    projection.potsSig = '';
    projection.hasPhase = false;
}

function projectBoard(projection: VisualProjection, board: DealBoard): void {
    const incoming = board.cards.map(cardSignature);
    if (board.phase === Phase.FLOP) {
        projection.boardSig = incoming.join(',');
    } else if (board.phase === Phase.TURN) {
        const merged = projection.boardSig ? [...projection.boardSig.split(','), ...incoming] : incoming;
        projection.boardSig = merged.slice(0, 4).join(',');
    } else if (board.phase === Phase.RIVER) {
        const merged = projection.boardSig ? [...projection.boardSig.split(','), ...incoming] : incoming;
        projection.boardSig = merged.slice(0, 5).join(',');
    } else {
        projection.boardSig = incoming.join(',');
    }
    projection.hasBoard = true;
    projection.hasPhase = true;
    projection.phase = board.phase;
}

function shouldSkipPotUpdate(projection: VisualProjection, update: PotUpdate): boolean {
    const nextPotsSig = potsSignature(update.pots);
    const unchanged = projection.hasPots && projection.potsSig === nextPotsSig;
    projection.hasPots = true;
    projection.potsSig = nextPotsSig;
    return unchanged;
}

function shouldSkipPhaseChange(projection: VisualProjection, change: PhaseChange): boolean {
    const nextBoardSig = cardsSignature(change.communityCards);
    const nextPotsSig = potsSignature(change.pots);

    const unchanged =
        projection.hasPhase &&
        projection.phase === change.phase &&
        projection.hasBoard &&
        projection.boardSig === nextBoardSig &&
        projection.hasPots &&
        projection.potsSig === nextPotsSig;

    projection.hasPhase = true;
    projection.phase = change.phase;
    projection.hasBoard = true;
    projection.boardSig = nextBoardSig;
    projection.hasPots = true;
    projection.potsSig = nextPotsSig;
    return unchanged;
}

function buildVisualSteps(tape: ReplayTape): number[] {
    const steps: number[] = [];
    const projection = createVisualProjection();
    for (let i = 0; i < tape.events.length; i++) {
        const event = tape.events[i];
        let shouldInclude = true;

        if (event.type === 'snapshot') {
            projectSnapshot(projection, event.value);
        } else if (event.type === 'handStart') {
            projectHandStart(projection);
        } else if (event.type === 'board') {
            projectBoard(projection, event.value);
        } else if (event.type === 'potUpdate') {
            if (shouldSkipPotUpdate(projection, event.value)) {
                // Skip pot updates that do not change visible pot layout.
                shouldInclude = false;
            }
        } else if (event.type === 'phaseChange') {
            if (shouldSkipPhaseChange(projection, event.value)) {
                // Skip phase-change envelopes that carry identical state.
                shouldInclude = false;
            }
        }

        if (!shouldInclude) {
            continue;
        }

        if (event.type === 'actionPrompt' && steps.length > 0) {
            const prevEvent = tape.events[steps[steps.length - 1]];
            if (prevEvent?.type === 'actionPrompt') {
                const prevSig = actionPromptSignature(prevEvent.value);
                const nextSig = actionPromptSignature(event.value);
                if (prevSig === nextSig) {
                    // Skip duplicated prompt step in visual timeline.
                    continue;
                }
            }
        }
        steps.push(i);
    }
    return steps;
}

function visualToRawCursor(visualSteps: number[], visualCursor: number): number {
    if (visualCursor < 0) {
        return -1;
    }
    return visualSteps[visualCursor] ?? -1;
}

export const useReplayStore = create<ReplayState>((set, get) => ({
    mode: 'idle',
    tape: null,
    isSeeking: false,
    silentFx: false,
    cursor: -1,
    visualSteps: [],

    loadTape: (tape) => {
        useGameStore.getState().resetForReplay(tape.heroChair);
        const visualSteps = buildVisualSteps(tape);
        set(() => ({
            mode: 'loaded',
            tape,
            isSeeking: false,
            silentFx: false,
            cursor: -1,
            visualSteps,
        }));
    },

    clearTape: () => {
        useGameStore.getState().resetForReplay(-1);
        set(() => ({
            mode: 'idle',
            tape: null,
            isSeeking: false,
            silentFx: false,
            cursor: -1,
            visualSteps: [],
        }));
    },

    stepForward: () => {
        const state = get();
        if (!state.tape) return;
        const nextCursor = Math.min(state.cursor + 1, state.visualSteps.length - 1);
        if (nextCursor === state.cursor || nextCursor < 0) return;
        const prevRaw = visualToRawCursor(state.visualSteps, state.cursor);
        const nextRaw = visualToRawCursor(state.visualSteps, nextCursor);
        if (nextRaw < 0) return;
        for (let raw = prevRaw + 1; raw <= nextRaw; raw++) {
            const event = state.tape.events[raw];
            if (!event) break;
            useGameStore.getState().ingest(event);
        }
        set(() => ({ cursor: nextCursor, isSeeking: false }));
    },

    stepBack: () => {
        const state = get();
        if (!state.tape) return;
        const nextCursor = Math.max(-1, state.cursor - 1);
        const nextRaw = visualToRawCursor(state.visualSteps, nextCursor);
        set(() => ({ silentFx: true }));
        try {
            applyTapeToRawCursor(state.tape, nextRaw);
            set(() => ({ cursor: nextCursor, isSeeking: false }));
        } finally {
            set(() => ({ silentFx: false }));
        }
    },

    seek: (targetCursor) => {
        const state = get();
        if (!state.tape) return;
        const clamped = Math.max(-1, Math.min(targetCursor, state.visualSteps.length - 1));
        const nextRaw = visualToRawCursor(state.visualSteps, clamped);
        applyTapeToRawCursor(state.tape, nextRaw);
        set(() => ({ cursor: clamped }));
    },

    beginSeek: () => {
        const state = get();
        if (state.mode !== 'loaded') {
            return;
        }
        set(() => ({ isSeeking: true }));
    },

    endSeek: () => {
        const state = get();
        if (!state.isSeeking) {
            return;
        }
        set(() => ({ isSeeking: false }));
    },
}));
