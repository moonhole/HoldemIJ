import { ActionType } from '@gen/messages_pb';
import type { GameStreamEvent } from '../../store/gameStore';
import type { ReiReplayState, ReiStatusTag } from '../types';

export type ReiReplaySnapshot = {
    machineState: ReiReplayState;
    statusTag: ReiStatusTag;
    keyLine: string;
    details: string;
    lastCursor: number;
    lastStreamSeq: number;
};

export type ReiReplayInput = {
    nowMs: number;
    isTableScene: boolean;
    replayLoaded: boolean;
    streamSeq: number;
    cursor: number;
    stepCount: number;
    lastEvent: GameStreamEvent | null;
};

export function initialReplaySnapshot(): ReiReplaySnapshot {
    return {
        machineState: 'disabled',
        statusTag: 'OFFLINE',
        keyLine: 'REI replay mode standing by.',
        details: 'Load replay data to enable step narration.',
        lastCursor: -1,
        lastStreamSeq: -1,
    };
}

export function reduceReplayMachine(prev: ReiReplaySnapshot, input: ReiReplayInput): ReiReplaySnapshot {
    if (!input.isTableScene || !input.replayLoaded) {
        return {
            machineState: 'disabled',
            statusTag: 'OFFLINE',
            keyLine: 'REI replay mode standing by.',
            details: 'Replay mode is currently inactive.',
            lastCursor: input.cursor,
            lastStreamSeq: input.streamSeq,
        };
    }

    if (input.cursor < 0) {
        return {
            machineState: 'ready',
            statusTag: 'READY',
            keyLine: 'Replay loaded. Start from Step 1.',
            details: 'Use STEP or slider seek to move timeline.',
            lastCursor: input.cursor,
            lastStreamSeq: input.streamSeq,
        };
    }

    if (input.cursor !== prev.lastCursor) {
        return summarizeReplayStep(input);
    }

    if (prev.machineState === 'stepSummary') {
        return {
            ...prev,
            machineState: 'atStep',
            statusTag: 'PAUSED',
            details: `Paused at Step ${input.cursor + 1}/${input.stepCount}.`,
        };
    }

    return prev;
}

function summarizeReplayStep(input: ReiReplayInput): ReiReplaySnapshot {
    const stepLabel = `${input.cursor + 1}/${input.stepCount}`;
    const base = {
        lastCursor: input.cursor,
        lastStreamSeq: input.streamSeq,
        machineState: 'stepSummary' as ReiReplayState,
        statusTag: 'STEP_SUMMARY' as ReiStatusTag,
    };

    if (!input.lastEvent) {
        return {
            ...base,
            keyLine: `Step ${stepLabel}: state aligned.`,
            details: 'No visible event at this cursor. Move forward.',
        };
    }

    switch (input.lastEvent.type) {
        case 'actionPrompt':
            return {
                ...base,
                keyLine: `Step ${stepLabel}: seat ${input.lastEvent.value.chair} to act.`,
                details: 'This is a key decision anchor in replay.',
            };
        case 'actionResult': {
            const action = actionTypeLabel(input.lastEvent.value.action);
            return {
                ...base,
                keyLine: `Step ${stepLabel}: seat ${input.lastEvent.value.chair} ${action}.`,
                details: `Committed amount is ${input.lastEvent.value.amount.toLocaleString()}.`,
            };
        }
        case 'board':
            return {
                ...base,
                keyLine: `Step ${stepLabel}: board cards dealt.`,
                details: 'Re-evaluate texture, pressure, and line fit.',
            };
        case 'phaseChange':
            return {
                ...base,
                keyLine: `Step ${stepLabel}: street state synced.`,
                details: 'Compare with previous step for meaningful delta.',
            };
        case 'potUpdate':
            return {
                ...base,
                keyLine: `Step ${stepLabel}: pot structure updated.`,
                details: 'Watch main/side pot impact on future decisions.',
            };
        case 'showdown':
            return {
                ...base,
                keyLine: `Step ${stepLabel}: showdown in progress.`,
                details: 'Validate whether prior actions match shown holdings.',
            };
        case 'handEnd':
        case 'winByFold':
            return {
                ...base,
                keyLine: `Step ${stepLabel}: hand finished.`,
                details: 'Review prior pivot for stronger EV branch.',
            };
        default:
            return {
                ...base,
                keyLine: `Step ${stepLabel}: ${input.lastEvent.type}.`,
                details: 'Continue stepping to inspect the full causal chain.',
            };
    }
}

function actionTypeLabel(action: ActionType): string {
    switch (action) {
        case ActionType.ACTION_CHECK:
            return 'CHECK';
        case ActionType.ACTION_CALL:
            return 'CALL';
        case ActionType.ACTION_BET:
            return 'BET';
        case ActionType.ACTION_RAISE:
            return 'RAISE';
        case ActionType.ACTION_ALLIN:
            return 'ALL-IN';
        case ActionType.ACTION_FOLD:
            return 'FOLD';
        default:
            return 'ACT';
    }
}
