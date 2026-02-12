import { ActionType } from '@gen/messages_pb';
import type { GameStreamEvent } from '../../store/gameStore';
import type { ReiLiveState, ReiStatusTag } from '../types';

export type ReiLiveSnapshot = {
    machineState: ReiLiveState;
    statusTag: ReiStatusTag;
    keyLine: string;
    details: string;
    lastStreamSeq: number;
};

export type ReiLiveInput = {
    nowMs: number;
    isTableScene: boolean;
    replayLoaded: boolean;
    connected: boolean;
    streamSeq: number;
    lastEvent: GameStreamEvent | null;
    myChair: number;
    actionPromptChair: number | null;
};

export function initialLiveSnapshot(): ReiLiveSnapshot {
    return {
        machineState: 'disabled',
        statusTag: 'OFFLINE',
        keyLine: 'REI standing by.',
        details: 'Enter a live table to start narration.',
        lastStreamSeq: -1,
    };
}

export function reduceLiveMachine(prev: ReiLiveSnapshot, input: ReiLiveInput): ReiLiveSnapshot {
    if (!input.isTableScene || input.replayLoaded) {
        return {
            machineState: 'disabled',
            statusTag: 'OFFLINE',
            keyLine: 'REI standing by.',
            details: 'Live narration is currently inactive.',
            lastStreamSeq: input.streamSeq,
        };
    }

    if (!input.connected) {
        return {
            machineState: 'syncing',
            statusTag: 'SYNCING',
            keyLine: 'Connecting and syncing table state.',
            details: 'Live narration resumes automatically after sync.',
            lastStreamSeq: input.streamSeq,
        };
    }

    if (!input.lastEvent || input.streamSeq <= prev.lastStreamSeq) {
        if (prev.machineState === 'disabled' || prev.machineState === 'syncing') {
            return {
                machineState: 'observe',
                statusTag: 'OBSERVE',
                keyLine: 'Live stream connected. Watching key events.',
                details: 'Hints are emitted on major decision points.',
                lastStreamSeq: input.streamSeq,
            };
        }
        return prev;
    }

    return summarizeLiveEvent(input.lastEvent, input);
}

function summarizeLiveEvent(event: GameStreamEvent, input: ReiLiveInput): ReiLiveSnapshot {
    const base = { lastStreamSeq: input.streamSeq };

    switch (event.type) {
        case 'handStart':
            return {
                ...base,
                machineState: 'observe',
                statusTag: 'OBSERVE',
                keyLine: 'New hand started. Recheck position and stack depth.',
                details: 'Plan your line before the first pressure point.',
            };
        case 'holeCards':
            return {
                ...base,
                machineState: 'observe',
                statusTag: 'OBSERVE',
                keyLine: 'Hole cards received. Build a clear baseline line.',
                details: 'Choose between control, pressure, or fold discipline.',
            };
        case 'actionPrompt': {
            const isHeroTurn = input.actionPromptChair !== null && input.actionPromptChair === input.myChair;
            if (isHeroTurn) {
                return {
                    ...base,
                    machineState: 'heroDecision',
                    statusTag: 'HERO_DECISION',
                    keyLine: 'Your turn. Check odds first, then choose action.',
                    details: 'Verify call cost and min raise threshold before committing.',
                };
            }
            return {
                ...base,
                machineState: 'observe',
                statusTag: 'OBSERVE',
                keyLine: `Seat ${event.value.chair} is in decision mode.`,
                details: 'Track sizing rhythm for future exploit spots.',
            };
        }
        case 'actionResult': {
            const actor = event.value.chair;
            const amount = event.value.amount;
            const action = actionTypeLabel(event.value.action);
            if (actor === input.myChair) {
                return {
                    ...base,
                    machineState: 'waitResult',
                    statusTag: 'WAIT_RESULT',
                    keyLine: `You chose ${action} to ${amount.toLocaleString()}.`,
                    details: 'Now watch for immediate pressure response from opponents.',
                };
            }
            return {
                ...base,
                machineState: 'observe',
                statusTag: 'OBSERVE',
                keyLine: `Seat ${actor} ${action} to ${amount.toLocaleString()}.`,
                details: 'This sizing update narrows likely ranges.',
            };
        }
        case 'board':
            return {
                ...base,
                machineState: 'observe',
                statusTag: 'OBSERVE',
                keyLine: 'Board updated. Recompute equity and pressure.',
                details: 'Re-evaluate texture and line consistency.',
            };
        case 'phaseChange':
            return {
                ...base,
                machineState: 'observe',
                statusTag: 'OBSERVE',
                keyLine: 'Street transition complete.',
                details: 'Decision cost is higher on later streets.',
            };
        case 'showdown':
            return {
                ...base,
                machineState: 'handWrap',
                statusTag: 'HAND_WRAP',
                keyLine: 'Showdown reached. Result resolving.',
                details: 'Compare revealed ranges with previous action story.',
            };
        case 'winByFold':
        case 'handEnd':
            return {
                ...base,
                machineState: 'handWrap',
                statusTag: 'HAND_WRAP',
                keyLine: 'Hand complete. Mark key decision points for review.',
                details: 'Short post-hand reflection improves next-hand quality.',
            };
        case 'error':
            return {
                ...base,
                machineState: 'syncing',
                statusTag: 'SYNCING',
                keyLine: `Stream warning: ${event.message}`,
                details: 'Waiting for state recovery.',
            };
        default:
            return {
                ...base,
                machineState: 'observe',
                statusTag: 'OBSERVE',
                keyLine: 'Live state updated.',
                details: 'Continue monitoring next key action.',
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
