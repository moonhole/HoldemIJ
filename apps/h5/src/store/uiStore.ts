import { create } from 'zustand';
import { gameClient } from '../network/GameClient';
import { useGameStore } from './gameStore';
import { useReplayStore } from '../replay/replayStore';

export type SceneName = 'boot' | 'login' | 'lobby' | 'table';

type QuickStartPhase = 'idle' | 'connecting' | 'sitting' | 'error';

type UiStoreState = {
    currentScene: SceneName;
    requestedScene: SceneName | null;

    quickStartPhase: QuickStartPhase;
    quickStartLabel: string;
    quickStartError: string;

    setCurrentScene: (scene: SceneName) => void;
    requestScene: (scene: SceneName) => void;
    consumeSceneRequest: (scene: SceneName) => void;
    startQuickStart: () => Promise<void>;
    resetQuickStart: () => void;
};

const QUICK_START_IDLE_LABEL = 'Quick Join';
const QUICK_START_WAIT_SNAPSHOT_MS = 8000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForInitialSnapshot(timeoutMs: number, minStreamSeq: number): Promise<void> {
    const state = useGameStore.getState();
    if (state.streamSeq > minStreamSeq && state.lastEvent?.type === 'snapshot' && state.snapshot) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        const finalize = (fn: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timeoutId);
            unsubscribe();
            fn();
        };

        const timeoutId = window.setTimeout(() => {
            finalize(() => reject(new Error('No table snapshot received. Check network/auth and retry.')));
        }, timeoutMs);

        const unsubscribe = useGameStore.subscribe((next, prev) => {
            if (next.streamSeq <= minStreamSeq) {
                return;
            }
            if (next.lastEvent?.type === 'snapshot' && next.snapshot) {
                finalize(() => resolve());
                return;
            }
            if (next.lastEvent?.type === 'error') {
                const message = next.errorMessage || 'Table sync failed';
                finalize(() => reject(new Error(message)));
                return;
            }
            if (prev.connected && !next.connected) {
                finalize(() => reject(new Error('WebSocket disconnected before table sync.')));
            }
        });
    });
}

export const useUiStore = create<UiStoreState>((set) => ({
    currentScene: 'login',
    requestedScene: null,

    quickStartPhase: 'idle',
    quickStartLabel: QUICK_START_IDLE_LABEL,
    quickStartError: '',

    setCurrentScene: (scene) =>
        set((state) => ({
            ...state,
            currentScene: scene,
            quickStartError: scene === 'lobby' ? state.quickStartError : '',
        })),

    requestScene: (scene) =>
        set((state) => ({
            ...state,
            requestedScene: scene,
        })),

    consumeSceneRequest: (scene) =>
        set((state) => {
            if (state.requestedScene !== scene) {
                return state;
            }
            return {
                ...state,
                requestedScene: null,
            };
        }),

    startQuickStart: async () => {
        const state = useUiStore.getState();
        if (state.quickStartPhase === 'connecting' || state.quickStartPhase === 'sitting') {
            return;
        }

        // Entering live table should always leave replay mode.
        useReplayStore.getState().clearTape();

        set((prev) => ({
            ...prev,
            quickStartPhase: 'connecting',
            quickStartLabel: 'Connecting...',
            quickStartError: '',
        }));

        try {
            const gameState = useGameStore.getState();
            if (gameClient.isConnected && !gameState.connected) {
                gameClient.disconnect();
                await delay(80);
            }

            if (!gameClient.isConnected) {
                await gameClient.connect();
            }
            const minStreamSeq = useGameStore.getState().streamSeq;
            gameClient.joinTable();

            set((prev) => ({
                ...prev,
                quickStartPhase: 'sitting',
                quickStartLabel: 'Syncing table...',
            }));

            await waitForInitialSnapshot(QUICK_START_WAIT_SNAPSHOT_MS, minStreamSeq);

            set((prev) => ({
                ...prev,
                quickStartPhase: 'idle',
                quickStartLabel: QUICK_START_IDLE_LABEL,
                quickStartError: '',
                requestedScene: 'table',
            }));
        } catch (error) {
            console.error('[UiStore] Quick start failed', error);
            set((prev) => ({
                ...prev,
                quickStartPhase: 'error',
                quickStartLabel: 'Connection Failed - Retry',
                quickStartError: error instanceof Error ? error.message : 'Connection failed',
            }));
        }
    },

    resetQuickStart: () =>
        set((state) => ({
            ...state,
            quickStartPhase: 'idle',
            quickStartLabel: QUICK_START_IDLE_LABEL,
            quickStartError: '',
        })),
}));
