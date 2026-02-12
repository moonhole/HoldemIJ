import { fromBinary } from '@bufbuild/protobuf';
import { ServerEnvelopeSchema, type ServerEnvelope } from '@gen/messages_pb';
import type { GameStreamEvent } from '../store/gameStore';
import type { ReplayTape } from './replayStore';

export type ReplayServerEvent = {
    type: string;
    seq: number;
    value?: ServerEnvelope;
    envelopeB64?: string;
};

export type ReplayServerTape = {
    tapeVersion: number;
    tableId: string;
    heroChair: number;
    events: ReplayServerEvent[];
};

export type ReplayServerInitResponse = {
    ok: boolean;
    tape?: ReplayServerTape;
    error?: {
        step_index?: number;
        reason?: string;
        message?: string;
    };
};

export function decodeReplayServerTape(input: ReplayServerTape): ReplayTape {
    return {
        tapeVersion: input.tapeVersion,
        tableId: input.tableId,
        heroChair: input.heroChair,
        events: input.events
            .map((event) => decodeReplayServerEvent(event))
            .filter((event): event is GameStreamEvent => event !== null),
    };
}

function decodeReplayServerEvent(event: ReplayServerEvent): GameStreamEvent | null {
    if (event.value) {
        return toGameStreamEvent(event.value);
    }
    if (!event.envelopeB64) {
        return null;
    }
    const raw = atob(event.envelopeB64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    const env = fromBinary(ServerEnvelopeSchema, bytes);
    return toGameStreamEvent(env);
}

function toGameStreamEvent(env: ServerEnvelope): GameStreamEvent | null {
    switch (env.payload.case) {
        case 'tableSnapshot':
            return { type: 'snapshot', value: env.payload.value };
        case 'actionPrompt':
            return { type: 'actionPrompt', value: env.payload.value };
        case 'handStart':
            return { type: 'handStart', value: env.payload.value };
        case 'dealHoleCards':
            return { type: 'holeCards', value: env.payload.value };
        case 'dealBoard':
            return { type: 'board', value: env.payload.value };
        case 'potUpdate':
            return { type: 'potUpdate', value: env.payload.value };
        case 'phaseChange':
            return { type: 'phaseChange', value: env.payload.value };
        case 'actionResult':
            return { type: 'actionResult', value: env.payload.value };
        case 'showdown':
            return { type: 'showdown', value: env.payload.value };
        case 'handEnd':
            return { type: 'handEnd', value: env.payload.value };
        case 'winByFold':
            return { type: 'winByFold', value: env.payload.value };
        case 'seatUpdate':
            return { type: 'seatUpdate', value: env.payload.value };
        case 'error':
            return {
                type: 'error',
                code: env.payload.value.code,
                message: env.payload.value.message,
            };
        default:
            return null;
    }
}
