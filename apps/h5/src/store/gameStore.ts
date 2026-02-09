import { create } from 'zustand';
import type {
    ActionPrompt,
    ActionResult,
    DealBoard,
    DealHoleCards,
    HandEnd,
    HandStart,
    PhaseChange,
    PotUpdate,
    SeatUpdate,
    Showdown,
    TableSnapshot,
    WinByFold,
} from '@gen/messages_pb';
import { gameClient } from '../network/GameClient';

export type GameStreamEvent =
    | { type: 'connect' }
    | { type: 'disconnect' }
    | { type: 'snapshot'; value: TableSnapshot }
    | { type: 'actionPrompt'; value: ActionPrompt }
    | { type: 'handStart'; value: HandStart }
    | { type: 'holeCards'; value: DealHoleCards }
    | { type: 'board'; value: DealBoard }
    | { type: 'potUpdate'; value: PotUpdate }
    | { type: 'phaseChange'; value: PhaseChange }
    | { type: 'actionResult'; value: ActionResult }
    | { type: 'showdown'; value: Showdown }
    | { type: 'handEnd'; value: HandEnd }
    | { type: 'winByFold'; value: WinByFold }
    | { type: 'seatUpdate'; value: SeatUpdate }
    | { type: 'error'; code: number; message: string };

type StoreMeta = {
    myChair?: number;
    myBet?: bigint;
};

type GameStoreState = {
    connected: boolean;
    streamSeq: number;
    lastEvent: GameStreamEvent | null;

    myChair: number;
    myBet: bigint;

    snapshot: TableSnapshot | null;
    handStart: HandStart | null;
    holeCards: DealHoleCards | null;
    actionPrompt: ActionPrompt | null;
    phaseChange: PhaseChange | null;
    potUpdate: PotUpdate | null;
    errorMessage: string;

    ingest: (event: GameStreamEvent, meta?: StoreMeta) => void;
    dismissActionPrompt: () => void;
    clearError: () => void;
    setExpectedHeroChair: (chair: number) => void;
};

function applyMeta(next: GameStoreState, meta?: StoreMeta): void {
    if (!meta) {
        return;
    }
    if (meta.myChair !== undefined && meta.myChair !== -1) {
        next.myChair = meta.myChair;
    }
    if (meta.myBet !== undefined) {
        next.myBet = meta.myBet;
    }
}

export const useGameStore = create<GameStoreState>((set) => ({
    connected: false,
    streamSeq: 0,
    lastEvent: null,

    myChair: -1,
    myBet: 0n,

    snapshot: null,
    handStart: null,
    holeCards: null,
    actionPrompt: null,
    phaseChange: null,
    potUpdate: null,
    errorMessage: '',

    ingest: (event, meta) =>
        set((state) => {
            const next: GameStoreState = {
                ...state,
                streamSeq: state.streamSeq + 1,
                lastEvent: event,
            };
            applyMeta(next, meta);

            switch (event.type) {
                case 'connect':
                    next.connected = true;
                    break;
                case 'disconnect':
                    next.connected = false;
                    next.actionPrompt = null;
                    next.errorMessage = '';
                    break;
                case 'snapshot':
                    next.snapshot = event.value;
                    break;
                case 'actionPrompt':
                    next.actionPrompt = event.value;
                    break;
                case 'handStart':
                    next.handStart = event.value;
                    next.actionPrompt = null;
                    next.holeCards = null;
                    next.myBet = 0n;
                    break;
                case 'holeCards':
                    next.holeCards = event.value;
                    break;
                case 'board':
                    break;
                case 'potUpdate':
                    next.potUpdate = event.value;
                    break;
                case 'phaseChange':
                    next.phaseChange = event.value;
                    next.myBet = 0n;
                    break;
                case 'actionResult':
                    break;
                case 'showdown':
                    break;
                case 'handEnd':
                    next.actionPrompt = null;
                    next.myBet = 0n;
                    break;
                case 'winByFold':
                    next.actionPrompt = null;
                    next.myBet = 0n;
                    break;
                case 'seatUpdate':
                    break;
                case 'error':
                    next.errorMessage = event.message;
                    break;
            }
            return next;
        }),

    dismissActionPrompt: () =>
        set((state) => ({
            ...state,
            actionPrompt: null,
        })),

    clearError: () =>
        set((state) => ({
            ...state,
            errorMessage: '',
        })),

    setExpectedHeroChair: (chair) =>
        set((state) => ({
            ...state,
            myChair: chair,
        })),
}));

function captureMeta(): StoreMeta {
    return {
        myChair: gameClient.myChair,
        myBet: gameClient.getMyBet(),
    };
}

let isBound = false;

export function bindGameClientToStore(): void {
    if (isBound) {
        return;
    }
    isBound = true;

    const store = useGameStore.getState();

    gameClient.subscribe({
        onConnect: () => store.ingest({ type: 'connect' }, captureMeta()),
        onDisconnect: () => store.ingest({ type: 'disconnect' }, captureMeta()),
        onSnapshot: (value) => store.ingest({ type: 'snapshot', value }, captureMeta()),
        onActionPrompt: (value) => store.ingest({ type: 'actionPrompt', value }, captureMeta()),
        onHandStart: (value) => store.ingest({ type: 'handStart', value }, captureMeta()),
        onHoleCards: (value) => store.ingest({ type: 'holeCards', value }, captureMeta()),
        onBoard: (value) => store.ingest({ type: 'board', value }, captureMeta()),
        onPotUpdate: (value) => store.ingest({ type: 'potUpdate', value }, captureMeta()),
        onPhaseChange: (value) => store.ingest({ type: 'phaseChange', value }, captureMeta()),
        onActionResult: (value) => store.ingest({ type: 'actionResult', value }, captureMeta()),
        onShowdown: (value) => store.ingest({ type: 'showdown', value }, captureMeta()),
        onHandEnd: (value) => store.ingest({ type: 'handEnd', value }, captureMeta()),
        onWinByFold: (value) => store.ingest({ type: 'winByFold', value }, captureMeta()),
        onSeatUpdate: (value) => store.ingest({ type: 'seatUpdate', value }, captureMeta()),
        onError: (code, message) => store.ingest({ type: 'error', code, message }, captureMeta()),
    });

    if (gameClient.lastSnapshot) {
        store.ingest({ type: 'snapshot', value: gameClient.lastSnapshot }, captureMeta());
    }
    if (gameClient.lastHandStart) {
        store.ingest({ type: 'handStart', value: gameClient.lastHandStart }, captureMeta());
    }
    if (gameClient.lastHoleCards) {
        store.ingest({ type: 'holeCards', value: gameClient.lastHoleCards }, captureMeta());
    }
    if (gameClient.lastActionPrompt) {
        store.ingest({ type: 'actionPrompt', value: gameClient.lastActionPrompt }, captureMeta());
    }
    if (gameClient.lastPhaseChange) {
        store.ingest({ type: 'phaseChange', value: gameClient.lastPhaseChange }, captureMeta());
    }
    if (gameClient.lastPotUpdate) {
        store.ingest({ type: 'potUpdate', value: gameClient.lastPotUpdate }, captureMeta());
    }
}
