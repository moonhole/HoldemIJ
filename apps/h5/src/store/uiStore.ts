import { create } from 'zustand';
import type { StoryProgressState } from '@gen/messages_pb';
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
    storyHighestCompletedChapter: number;
    storyHighestUnlockedChapter: number;
    storyCompletedChapters: number[];
    storyUnlockedFeatures: string[];
    selectedStoryChapter: number;

    setCurrentScene: (scene: SceneName) => void;
    requestScene: (scene: SceneName) => void;
    consumeSceneRequest: (scene: SceneName) => void;
    startQuickStart: () => Promise<void>;
    startStoryChapter: (chapterId: number) => Promise<void>;
    setSelectedStoryChapter: (chapterId: number) => void;
    ingestStoryProgress: (progress: StoryProgressState) => void;
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
    storyHighestCompletedChapter: 0,
    storyHighestUnlockedChapter: 1,
    storyCompletedChapters: [],
    storyUnlockedFeatures: [],
    selectedStoryChapter: 1,

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

    startStoryChapter: async (chapterId: number) => {
        const state = useUiStore.getState();
        if (state.quickStartPhase === 'connecting' || state.quickStartPhase === 'sitting') {
            return;
        }
        if (chapterId > state.storyHighestUnlockedChapter) {
            set((prev) => ({
                ...prev,
                quickStartPhase: 'error',
                quickStartLabel: 'Chapter Locked',
                quickStartError: `Chapter ${chapterId} is locked.`,
            }));
            return;
        }

        useReplayStore.getState().clearTape();

        set((prev) => ({
            ...prev,
            quickStartPhase: 'connecting',
            quickStartLabel: 'Loading chapter...',
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
            gameClient.startStory(chapterId);

            set((prev) => ({
                ...prev,
                quickStartPhase: 'sitting',
                quickStartLabel: 'Entering story...',
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
            console.error('[UiStore] Story start failed', error);
            set((prev) => ({
                ...prev,
                quickStartPhase: 'error',
                quickStartLabel: 'Connection Failed - Retry',
                quickStartError: error instanceof Error ? error.message : 'Story mode failed',
            }));
        }
    },

    setSelectedStoryChapter: (chapterId) =>
        set((state) => {
            if (!Number.isFinite(chapterId)) {
                return state;
            }
            const next = Math.trunc(chapterId);
            if (next < 1 || next > state.storyHighestUnlockedChapter) {
                return state;
            }
            return {
                ...state,
                selectedStoryChapter: next,
            };
        }),

    ingestStoryProgress: (progress) =>
        set((state) => {
            const highestCompleted = Math.max(0, Number(progress.highestCompletedChapter) || 0);
            const highestUnlocked = Math.max(1, Number(progress.highestUnlockedChapter) || 1);
            const completed = Array.from(
                new Set(progress.completedChapters.map((ch) => Math.trunc(Number(ch))).filter((ch) => ch > 0)),
            ).sort((a, b) => a - b);
            const features = Array.from(
                new Set(
                    progress.unlockedFeatures
                        .map((feature) => feature.trim())
                        .filter((feature) => feature.length > 0),
                ),
            ).sort();
            const selected =
                state.selectedStoryChapter > highestUnlocked ? highestUnlocked : Math.max(1, state.selectedStoryChapter);

            return {
                ...state,
                storyHighestCompletedChapter: highestCompleted,
                storyHighestUnlockedChapter: highestUnlocked,
                storyCompletedChapters: completed,
                storyUnlockedFeatures: features,
                selectedStoryChapter: selected,
            };
        }),

    resetQuickStart: () =>
        set((state) => ({
            ...state,
            quickStartPhase: 'idle',
            quickStartLabel: QUICK_START_IDLE_LABEL,
            quickStartError: '',
        })),
}));

let isUiClientBound = false;

export function bindUiClientToStore(): void {
    if (isUiClientBound) {
        return;
    }
    isUiClientBound = true;

    gameClient.subscribe({
        onStoryProgress: (value) => {
            useUiStore.getState().ingestStoryProgress(value);
        },
    });
}
