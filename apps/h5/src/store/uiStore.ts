import { create } from 'zustand';
import type { StoryChapterInfo, StoryProgressState } from '@gen/messages_pb';
import { gameClient } from '../network/GameClient';
import type { ReiStoryNarration } from '../rei/types';
import { useGameStore } from './gameStore';
import { useReplayStore } from '../replay/replayStore';
import { getStoryFeatureMeta, storyChapterTitle } from '../story/storyCatalog';

export type SceneName = 'boot' | 'login' | 'lobby' | 'table';

type QuickStartPhase = 'idle' | 'connecting' | 'sitting' | 'error';
type StoryStartMode = 'start' | 'resume';

export type PausedStoryInstance = {
    chapterId: number;
    tableId: string;
    pausedAtMs: number;
};

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
    storyProgressHydrated: boolean;
    storyChapterInfo: StoryChapterInfo | null;
    storyReiNarration: ReiStoryNarration | null;
    pausedStoryInstance: PausedStoryInstance | null;
    selectedStoryChapter: number;

    setCurrentScene: (scene: SceneName) => void;
    requestScene: (scene: SceneName) => void;
    consumeSceneRequest: (scene: SceneName) => void;
    returnLobbyFromTable: () => void;
    startQuickStart: () => Promise<void>;
    startStoryChapter: (chapterId: number, mode?: StoryStartMode) => Promise<void>;
    resumePausedStory: () => Promise<void>;
    restartStoryChapter: (chapterId: number) => Promise<void>;
    setSelectedStoryChapter: (chapterId: number) => void;
    ingestStoryChapterInfo: (info: StoryChapterInfo) => void;
    ingestStoryProgress: (progress: StoryProgressState) => void;
    resetQuickStart: () => void;
};

const QUICK_START_IDLE_LABEL = 'Quick Join';
const QUICK_START_WAIT_SNAPSHOT_MS = 8000;
const RETURN_LOBBY_DISCONNECT_GRACE_MS = 350;
const STORY_NARRATION_CHAPTER_INTRO_TTL_MS = 20000;
const STORY_NARRATION_CHAPTER_CLEAR_TTL_MS = 22000;

function normalizeStoryText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function featureLabel(featureId: string): string {
    const meta = getStoryFeatureMeta(featureId);
    if (meta) {
        return meta.label;
    }
    return featureId.replace(/_/g, ' ').trim();
}

function formatFeatureList(features: string[]): string {
    const labels = features.map(featureLabel);
    if (labels.length === 0) {
        return '';
    }
    if (labels.length === 1) {
        return labels[0];
    }
    if (labels.length === 2) {
        return `${labels[0]} and ${labels[1]}`;
    }
    return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function buildChapterIntroNarration(info: StoryChapterInfo): ReiStoryNarration {
    const chapterId = Math.max(1, Math.trunc(Number(info.chapterId) || 1));
    const now = Date.now();
    const intro = normalizeStoryText(info.reiIntro);
    const boss = normalizeStoryText(info.bossName);
    const bossNote = normalizeStoryText(info.reiBossNote);
    const detailsParts = [
        intro,
        boss && bossNote ? `Boss ${boss}: ${bossNote}` : bossNote,
    ].filter((part) => part.length > 0);

    return {
        id: now,
        statusTag: 'OBSERVE',
        keyLine: `${storyChapterTitle(chapterId)} started.`,
        details: detailsParts.join(' '),
        expiresAtMs: now + STORY_NARRATION_CHAPTER_INTRO_TTL_MS,
    };
}

function buildChapterCompleteNarration(
    chapterId: number,
    newlyUnlockedFeatures: string[],
    highestUnlockedChapter: number,
): ReiStoryNarration {
    const now = Date.now();
    const featureText = formatFeatureList(newlyUnlockedFeatures);
    const unlockText = featureText.length > 0 ? `Unlocked: ${featureText}.` : 'Progress synchronized.';
    const nextText =
        highestUnlockedChapter > chapterId
            ? `${storyChapterTitle(highestUnlockedChapter)} is now unlocked.`
            : 'Story progression updated.';

    return {
        id: now,
        statusTag: 'HAND_WRAP',
        keyLine: `${storyChapterTitle(chapterId)} completed.`,
        details: `${unlockText} ${nextText}`,
        expiresAtMs: now + STORY_NARRATION_CHAPTER_CLEAR_TTL_MS,
    };
}

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
    storyProgressHydrated: false,
    storyChapterInfo: null,
    storyReiNarration: null,
    pausedStoryInstance: null,
    selectedStoryChapter: 1,

    setCurrentScene: (scene) =>
        set((state) => ({
            ...state,
            currentScene: scene,
            quickStartError: scene === 'lobby' ? state.quickStartError : '',
            pausedStoryInstance: scene === 'login' ? null : state.pausedStoryInstance,
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

    returnLobbyFromTable: () => {
        const state = useUiStore.getState();
        const gameState = useGameStore.getState();
        const currentTableId = gameClient.getCurrentTableId();
        const storyInfo = state.storyChapterInfo;
        const isStoryTableActive =
            !!storyInfo &&
            storyInfo.tableId.length > 0 &&
            storyInfo.tableId === currentTableId &&
            gameState.myChair !== -1;

        set((prev) => {
            let pausedStoryInstance = prev.pausedStoryInstance;
            if (isStoryTableActive && storyInfo) {
                pausedStoryInstance = {
                    chapterId: Math.max(1, Math.trunc(Number(storyInfo.chapterId) || prev.selectedStoryChapter)),
                    tableId: storyInfo.tableId,
                    pausedAtMs: Date.now(),
                };
            }
            return {
                ...prev,
                requestedScene: 'lobby',
                pausedStoryInstance,
            };
        });

        if (isStoryTableActive) {
            if (gameClient.isConnected) {
                gameClient.disconnect();
            }
            return;
        }

        if (gameState.myChair !== -1) {
            gameClient.standUp();
            window.setTimeout(() => {
                const latest = useUiStore.getState();
                if (latest.currentScene === 'lobby' && gameClient.isConnected) {
                    gameClient.disconnect();
                }
            }, RETURN_LOBBY_DISCONNECT_GRACE_MS);
            return;
        }

        if (gameClient.isConnected) {
            gameClient.disconnect();
        }
    },

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

    startStoryChapter: async (chapterId: number, mode: StoryStartMode = 'start') => {
        const state = useUiStore.getState();
        if (state.quickStartPhase === 'connecting' || state.quickStartPhase === 'sitting') {
            return;
        }
        const normalizedChapterId = Math.max(1, Math.trunc(Number(chapterId) || 1));
        if (mode === 'resume') {
            const paused = state.pausedStoryInstance;
            if (!paused || paused.chapterId !== normalizedChapterId) {
                set((prev) => ({
                    ...prev,
                    quickStartPhase: 'error',
                    quickStartLabel: 'No Paused Story',
                    quickStartError: 'No paused story session for this chapter.',
                }));
                return;
            }
        } else if (normalizedChapterId > state.storyHighestUnlockedChapter) {
            set((prev) => ({
                ...prev,
                quickStartPhase: 'error',
                quickStartLabel: 'Chapter Locked',
                quickStartError: `Chapter ${normalizedChapterId} is locked.`,
            }));
            return;
        }

        useReplayStore.getState().clearTape();

        set((prev) => ({
            ...prev,
            quickStartPhase: 'connecting',
            quickStartLabel: mode === 'resume' ? 'Resuming chapter...' : 'Loading chapter...',
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
            gameClient.startStory(normalizedChapterId, mode);

            set((prev) => ({
                ...prev,
                quickStartPhase: 'sitting',
                quickStartLabel: mode === 'resume' ? 'Rejoining paused table...' : 'Entering story...',
            }));

            await waitForInitialSnapshot(QUICK_START_WAIT_SNAPSHOT_MS, minStreamSeq);

            set((prev) => ({
                ...prev,
                quickStartPhase: 'idle',
                quickStartLabel: QUICK_START_IDLE_LABEL,
                quickStartError: '',
                pausedStoryInstance: null,
                requestedScene: 'table',
            }));
        } catch (error) {
            console.error('[UiStore] Story start failed', error);
            set((prev) => ({
                ...prev,
                quickStartPhase: 'error',
                quickStartLabel: 'Connection Failed - Retry',
                quickStartError: error instanceof Error ? error.message : mode === 'resume' ? 'Story resume failed' : 'Story mode failed',
            }));
        }
    },

    resumePausedStory: async () => {
        const state = useUiStore.getState();
        if (!state.pausedStoryInstance) {
            set((prev) => ({
                ...prev,
                quickStartPhase: 'error',
                quickStartLabel: 'No Paused Story',
                quickStartError: 'No paused story session found.',
            }));
            return;
        }
        await useUiStore.getState().startStoryChapter(state.pausedStoryInstance.chapterId, 'resume');
    },

    restartStoryChapter: async (chapterId) => {
        await useUiStore.getState().startStoryChapter(chapterId, 'start');
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

    ingestStoryChapterInfo: (info) =>
        set((state) => {
            const chapterId = Math.max(1, Math.trunc(Number(info.chapterId) || 1));
            return {
                ...state,
                storyChapterInfo: info,
                selectedStoryChapter:
                    chapterId <= state.storyHighestUnlockedChapter ? chapterId : state.selectedStoryChapter,
                storyReiNarration: buildChapterIntroNarration(info),
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
            const newlyCompleted = completed.filter((chapter) => !state.storyCompletedChapters.includes(chapter));
            const newlyUnlockedFeatures = features.filter((feature) => !state.storyUnlockedFeatures.includes(feature));
            let storyReiNarration = state.storyReiNarration;
            if (state.storyProgressHydrated && newlyCompleted.length > 0) {
                const chapterId = newlyCompleted[newlyCompleted.length - 1];
                storyReiNarration = buildChapterCompleteNarration(chapterId, newlyUnlockedFeatures, highestUnlocked);
            }
            const selected =
                state.selectedStoryChapter > highestUnlocked ? highestUnlocked : Math.max(1, state.selectedStoryChapter);

            return {
                ...state,
                storyHighestCompletedChapter: highestCompleted,
                storyHighestUnlockedChapter: highestUnlocked,
                storyCompletedChapters: completed,
                storyUnlockedFeatures: features,
                storyProgressHydrated: true,
                storyReiNarration,
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
        onStoryChapterInfo: (value) => {
            useUiStore.getState().ingestStoryChapterInfo(value);
        },
        onStoryProgress: (value) => {
            useUiStore.getState().ingestStoryProgress(value);
        },
    });
}
