import type { GameStreamEvent } from '../store/gameStore';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { useReplayStore } from '../replay/replayStore';
import { useReiStore } from './reiStore';
import type { ReiWorkerRequestMessage, ReiWorkerResponseMessage } from './runtimeWorkerProtocol';
import type { ReiRuntimeEvent, ReiRuntimeInput } from './types';

const REI_WORKER_MIN_INTERVAL_MS = 33;

let isBound = false;
let runtimeWorker: Worker | null = null;
let workerUnavailable = false;
let dispatchTimer: number | null = null;
let latestInput: ReiRuntimeInput | null = null;
let dirty = false;
let inFlight = false;
let lastDispatchAtMs = 0;

function toReiRuntimeEvent(event: GameStreamEvent | null): ReiRuntimeEvent | null {
    if (!event) {
        return null;
    }

    switch (event.type) {
        case 'actionPrompt':
            return { type: 'actionPrompt', chair: event.value.chair };
        case 'actionResult':
            return {
                type: 'actionResult',
                chair: event.value.chair,
                action: event.value.action,
                amount: event.value.amount,
            };
        case 'error':
            return { type: 'error', message: event.message };
        case 'connect':
        case 'disconnect':
        case 'snapshot':
        case 'handStart':
        case 'holeCards':
        case 'board':
        case 'potUpdate':
        case 'phaseChange':
        case 'showdown':
        case 'handEnd':
        case 'winByFold':
        case 'seatUpdate':
            return { type: event.type };
        default:
            return null;
    }
}

function collectRuntimeInput(): ReiRuntimeInput {
    const ui = useUiStore.getState();
    const replay = useReplayStore.getState();
    const game = useGameStore.getState();

    return {
        nowMs: Date.now(),
        isTableScene: ui.currentScene === 'table',
        replayLoaded: replay.mode === 'loaded',
        connected: game.connected,
        streamSeq: game.streamSeq,
        lastEvent: toReiRuntimeEvent(game.lastEvent),
        myChair: game.myChair,
        actionPromptChair: game.actionPrompt?.chair ?? null,
        replayCursor: replay.cursor,
        replayStepCount: replay.visualSteps.length,
        replaySeeking: replay.isSeeking,
    };
}

function runTickInMainThread(input: ReiRuntimeInput): void {
    useReiStore.getState().tick(input);
}

function clearDispatchTimer(): void {
    if (dispatchTimer !== null) {
        window.clearTimeout(dispatchTimer);
        dispatchTimer = null;
    }
}

function scheduleDispatch(delayMs: number = 0): void {
    if (dispatchTimer !== null) {
        return;
    }

    dispatchTimer = window.setTimeout(() => {
        dispatchTimer = null;
        flushWorkerTick();
    }, delayMs);
}

function flushWorkerTick(): void {
    if (!dirty || !latestInput) {
        return;
    }

    if (!runtimeWorker || workerUnavailable) {
        dirty = false;
        runTickInMainThread(latestInput);
        return;
    }

    if (inFlight) {
        return;
    }

    const elapsed = Date.now() - lastDispatchAtMs;
    if (elapsed < REI_WORKER_MIN_INTERVAL_MS) {
        scheduleDispatch(REI_WORKER_MIN_INTERVAL_MS - elapsed);
        return;
    }

    const message: ReiWorkerRequestMessage = {
        type: 'tick',
        input: latestInput,
    };

    try {
        inFlight = true;
        dirty = false;
        lastDispatchAtMs = Date.now();
        runtimeWorker.postMessage(message);
    } catch (err) {
        console.warn('[REI] worker postMessage failed, falling back to main thread', err);
        inFlight = false;
        workerUnavailable = true;
        if (runtimeWorker) {
            runtimeWorker.terminate();
            runtimeWorker = null;
        }
        runTickInMainThread(latestInput);
    }
}

function enqueueTick(): void {
    latestInput = collectRuntimeInput();

    if (workerUnavailable || !runtimeWorker) {
        runTickInMainThread(latestInput);
        return;
    }

    dirty = true;
    scheduleDispatch();
}

function createWorkerIfPossible(): void {
    if (runtimeWorker || workerUnavailable) {
        return;
    }

    try {
        runtimeWorker = new Worker(new URL('./reiRuntime.worker.ts', import.meta.url), { type: 'module' });
        runtimeWorker.onmessage = (event: MessageEvent<ReiWorkerResponseMessage>) => {
            const message = event.data;
            if (message.type !== 'tickResult') {
                return;
            }

            inFlight = false;
            if (message.changed) {
                useReiStore.getState().applyRuntimeState(message.state);
            }

            if (dirty) {
                scheduleDispatch();
            }
        };
        runtimeWorker.onerror = (event) => {
            console.warn('[REI] worker errored, falling back to main thread', event.error ?? event.message);
            inFlight = false;
            workerUnavailable = true;
            clearDispatchTimer();
            if (runtimeWorker) {
                runtimeWorker.terminate();
                runtimeWorker = null;
            }
        };
    } catch (err) {
        console.warn('[REI] worker unavailable, running on main thread', err);
        runtimeWorker = null;
        workerUnavailable = true;
    }
}

export function bindReiRuntimeToStores(): void {
    if (isBound) {
        return;
    }
    isBound = true;

    createWorkerIfPossible();

    useUiStore.subscribe(() => enqueueTick());
    useReplayStore.subscribe(() => enqueueTick());
    useGameStore.subscribe(() => enqueueTick());
    enqueueTick();
}
