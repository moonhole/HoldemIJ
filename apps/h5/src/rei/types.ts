import { ActionType } from '@gen/messages_pb';

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
    lastEvent: ReiRuntimeEvent | null;
    myChair: number;
    actionPromptChair: number | null;
    replayCursor: number;
    replayStepCount: number;
    replaySeeking: boolean;
};

export type ReiRuntimeEvent =
    | { type: 'connect' }
    | { type: 'disconnect' }
    | { type: 'snapshot' }
    | { type: 'actionPrompt'; chair: number }
    | { type: 'handStart' }
    | { type: 'holeCards' }
    | { type: 'board' }
    | { type: 'potUpdate' }
    | { type: 'phaseChange' }
    | { type: 'actionResult'; chair: number; action: ActionType; amount: bigint }
    | { type: 'showdown' }
    | { type: 'handEnd' }
    | { type: 'winByFold' }
    | { type: 'seatUpdate' }
    | { type: 'error'; message: string };
