import { useReplayStore } from '../replay/replayStore';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { useReiStore } from './reiStore';

let isBound = false;

function tickReiRuntime(): void {
    const ui = useUiStore.getState();
    const replay = useReplayStore.getState();
    const game = useGameStore.getState();
    useReiStore.getState().tick({
        nowMs: Date.now(),
        isTableScene: ui.currentScene === 'table',
        replayLoaded: replay.mode === 'loaded',
        connected: game.connected,
        streamSeq: game.streamSeq,
        lastEvent: game.lastEvent,
        myChair: game.myChair,
        actionPromptChair: game.actionPrompt?.chair ?? null,
        replayCursor: replay.cursor,
        replayStepCount: replay.visualSteps.length,
        replaySeeking: replay.isSeeking,
    });
}

export function bindReiRuntimeToStores(): void {
    if (isBound) {
        return;
    }
    isBound = true;

    useUiStore.subscribe(() => tickReiRuntime());
    useReplayStore.subscribe(() => tickReiRuntime());
    useGameStore.subscribe(() => tickReiRuntime());
    tickReiRuntime();
}
