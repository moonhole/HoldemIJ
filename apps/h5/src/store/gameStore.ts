import { create } from 'zustand';
import { ActionType } from '@gen/messages_pb';
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
                    next.potUpdate = null;
                    next.myBet = 0n;
                    if (next.snapshot) {
                        const start = event.value;
                        const players = next.snapshot.players.map(p => {
                            let bet = 0n;
                            let stack = p.stack;
                            const hasCards = p.stack > 0n;
                            if (p.chair === start.smallBlindChair) {
                                bet = start.smallBlindAmount;
                                stack -= start.smallBlindAmount;
                            } else if (p.chair === start.bigBlindChair) {
                                bet = start.bigBlindAmount;
                                stack -= start.bigBlindAmount;
                            }
                            return { ...p, bet, stack, folded: false, allIn: false, hasCards };
                        });
                        next.snapshot = {
                            ...next.snapshot,
                            players,
                            pots: [], // Clear pots for new hand
                            dealerChair: start.dealerChair,
                            smallBlindChair: start.smallBlindChair,
                            bigBlindChair: start.bigBlindChair,
                        };

                        // Sync myBet if I am in blinds
                        if (next.myChair === start.smallBlindChair) next.myBet = start.smallBlindAmount;
                        if (next.myChair === start.bigBlindChair) next.myBet = start.bigBlindAmount;
                    }
                    break;
                case 'holeCards':
                    next.holeCards = event.value;
                    break;
                case 'board':
                    break;
                case 'potUpdate':
                    next.potUpdate = event.value;
                    if (next.snapshot) {
                        next.snapshot = { ...next.snapshot, pots: event.value.pots };
                    }
                    break;
                case 'phaseChange':
                    next.phaseChange = event.value;
                    next.myBet = 0n;
                    next.potUpdate = null; // High-level change overrides individual updates
                    if (next.snapshot) {
                        // When phase changes, bets are collected into pots on server
                        const players = next.snapshot.players.map(p => ({ ...p, bet: 0n }));
                        next.snapshot = {
                            ...next.snapshot,
                            players,
                            pots: event.value.pots,
                            phase: event.value.phase,
                            communityCards: event.value.communityCards
                        };
                    }
                    break;
                case 'actionResult':
                    if (next.snapshot) {
                        const { chair, newStack, amount, action } = event.value;
                        const players = next.snapshot.players.map((p) => {
                            if (p.chair === chair) {
                                return {
                                    ...p,
                                    stack: newStack,
                                    bet: amount,
                                    folded: action === ActionType.ACTION_FOLD ? true : p.folded,
                                    allIn: action === ActionType.ACTION_ALLIN ? true : p.allIn,
                                };
                            }
                            return p;
                        });
                        next.snapshot = { ...next.snapshot, players };

                        // Sync myBet if it's me
                        if (chair === next.myChair) {
                            next.myBet = amount;
                        }
                    }
                    break;
                case 'showdown':
                    break;
                case 'handEnd':
                    next.actionPrompt = null;
                    next.myBet = 0n;
                    next.potUpdate = null;
                    if (next.snapshot) {
                        const deltas = event.value.stackDeltas;
                        const players = next.snapshot.players.map(p => {
                            const delta = deltas.find(d => d.chair === p.chair);
                            if (delta) {
                                return { ...p, stack: delta.newStack, bet: 0n, folded: false, allIn: false, hasCards: false };
                            }
                            return { ...p, bet: 0n, folded: false, allIn: false, hasCards: false };
                        });
                        next.snapshot = { ...next.snapshot, players, pots: [] };
                    }
                    break;
                case 'winByFold':
                    next.actionPrompt = null;
                    next.myBet = 0n;
                    next.potUpdate = null;
                    if (next.snapshot) {
                        const players = next.snapshot.players.map(p => ({ ...p, bet: 0n, hasCards: false }));
                        next.snapshot = { ...next.snapshot, players, pots: [] };
                    }
                    break;
                case 'seatUpdate':
                    if (next.snapshot) {
                        const { chair, update } = event.value;
                        const players = [...next.snapshot.players];

                        if (update.case === 'playerJoined') {
                            const newPlayer = update.value;
                            const idx = players.findIndex(p => p.chair === chair);
                            if (idx !== -1) {
                                players[idx] = newPlayer;
                            } else {
                                players.push(newPlayer);
                            }
                        } else if (update.case === 'playerLeftUserId') {
                            next.snapshot.players = players.filter(p => p.chair !== chair);
                        } else if (update.case === 'stackChange') {
                            const idx = players.findIndex(p => p.chair === chair);
                            if (idx !== -1) {
                                players[idx] = { ...players[idx], stack: update.value };
                            }
                        }

                        if (update.case !== 'playerLeftUserId') {
                            next.snapshot = { ...next.snapshot, players };
                        }
                    }
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
