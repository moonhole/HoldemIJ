import type { GameStreamEvent } from '../store/gameStore';

export type ReiMode = 'disabled' | 'live' | 'replay';

export type ReiLiveState =
    | 'disabled'
    | 'syncing'
    | 'observe'
    | 'heroDecision'
    | 'waitResult'
    | 'handWrap';

export type ReiReplayState =
    | 'disabled'
    | 'ready'
    | 'atStep'
    | 'stepSummary'
    | 'paused';

export type ReiMachineState = ReiLiveState | ReiReplayState;

export type ReiStatusTag =
    | 'OFFLINE'
    | 'SYNCING'
    | 'OBSERVE'
    | 'HERO_DECISION'
    | 'WAIT_RESULT'
    | 'HAND_WRAP'
    | 'READY'
    | 'STEP_SUMMARY'
    | 'PAUSED';

export type ReiViewModel = {
    mode: ReiMode;
    machineState: ReiMachineState;
    statusTag: ReiStatusTag;
    keyLine: string;
    details: string;
    updatedAtMs: number;
};

export type ReiRuntimeInput = {
    nowMs: number;
    isTableScene: boolean;
    replayLoaded: boolean;
    connected: boolean;
    streamSeq: number;
    lastEvent: GameStreamEvent | null;
    myChair: number;
    actionPromptChair: number | null;
    replayCursor: number;
    replayStepCount: number;
};
