import { AuthApiError } from './authApi';
import { gameClient } from './GameClient';

export type AuditSource = 'live' | 'replay';

export type AuditRecentHandItem = {
    handId: string;
    source: AuditSource;
    playedAt: string;
    isSaved: boolean;
    savedAt?: string;
    summary: Record<string, unknown>;
    updatedAt: string;
};

export type AuditHandEvent = {
    seq: number;
    eventType: string;
    envelopeB64: string;
    serverTsMs?: number;
};

type RawErrorResult = {
    error?: string;
};

type RawAuditRecentItem = {
    hand_id: string;
    source: AuditSource;
    played_at: string;
    is_saved: boolean;
    saved_at?: string | null;
    summary?: Record<string, unknown>;
    updated_at: string;
};

type RawAuditRecentResponse = {
    items?: RawAuditRecentItem[];
};

type RawAuditHandEvent = {
    seq: number;
    event_type: string;
    envelope_b64: string;
    server_ts_ms?: number;
};

type RawAuditHandResponse = {
    hand_id: string;
    source: AuditSource;
    events?: RawAuditHandEvent[];
};

async function readJson<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
}

async function parseError(res: Response): Promise<never> {
    let message = `Request failed (${res.status})`;
    try {
        const payload = await readJson<RawErrorResult>(res);
        if (payload.error) {
            message = payload.error;
        }
    } catch {
        // ignore invalid error body
    }
    throw new AuthApiError(res.status, message);
}

function authHeader(): Record<string, string> {
    const token = gameClient.getSessionToken();
    if (!token) {
        throw new AuthApiError(401, 'missing session token');
    }
    return { Authorization: `Bearer ${token}` };
}

function normalizeRecent(item: RawAuditRecentItem): AuditRecentHandItem {
    return {
        handId: item.hand_id,
        source: item.source,
        playedAt: item.played_at,
        isSaved: item.is_saved,
        savedAt: item.saved_at ?? undefined,
        summary: item.summary ?? {},
        updatedAt: item.updated_at,
    };
}

function normalizeHandEvent(ev: RawAuditHandEvent): AuditHandEvent {
    return {
        seq: ev.seq,
        eventType: ev.event_type,
        envelopeB64: ev.envelope_b64,
        serverTsMs: ev.server_ts_ms,
    };
}

export const auditApi = {
    async listRecent(source: AuditSource, limit = 20): Promise<AuditRecentHandItem[]> {
        const res = await fetch(`/api/audit/${source}/recent?limit=${encodeURIComponent(String(limit))}`, {
            method: 'GET',
            headers: authHeader(),
        });
        if (!res.ok) {
            return parseError(res);
        }
        const payload = await readJson<RawAuditRecentResponse>(res);
        return (payload.items ?? []).map(normalizeRecent);
    },

    async getHand(source: AuditSource, handId: string): Promise<AuditHandEvent[]> {
        const res = await fetch(`/api/audit/${source}/hands/${encodeURIComponent(handId)}`, {
            method: 'GET',
            headers: authHeader(),
        });
        if (!res.ok) {
            return parseError(res);
        }
        const payload = await readJson<RawAuditHandResponse>(res);
        return (payload.events ?? []).map(normalizeHandEvent);
    },
};
