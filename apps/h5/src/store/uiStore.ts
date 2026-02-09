import { create } from 'zustand';
import { gameClient } from '../network/GameClient';
import { useGameStore } from './gameStore';

export type SceneName = 'boot' | 'lobby' | 'table';

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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const useUiStore = create<UiStoreState>((set) => ({
    currentScene: 'boot',
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

        set((prev) => ({
                ...prev,
                quickStartPhase: 'connecting',
                quickStartLabel: 'Connecting...',
                quickStartError: '',
        }));

        try {
            if (!gameClient.isConnected) {
                await gameClient.connect();
            }
            gameClient.joinTable();

            set((prev) => ({
                ...prev,
                quickStartPhase: 'sitting',
                quickStartLabel: 'Joining table...',
            }));

            const randomSeat = Math.floor(Math.random() * 6);
            gameClient.myChair = randomSeat;
            useGameStore.getState().setExpectedHeroChair(randomSeat);
            gameClient.sitDown(randomSeat, 10000n);

            await delay(500);

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
