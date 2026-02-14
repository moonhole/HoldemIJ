import { resolveApiUrl } from './runtimeConfig';

export class AuthApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export type AuthResult = {
    userId: bigint;
    sessionToken: string;
};

export type MeResult = {
    userId: bigint;
    username: string;
};

type RawAuthResult = {
    user_id: number;
    session_token: string;
};

type RawMeResult = {
    user_id: number;
    username: string;
};

type RawErrorResult = {
    error?: string;
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

function authHeader(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
}

export const authApi = {
    async register(username: string, password: string): Promise<AuthResult> {
        const res = await fetch(resolveApiUrl('/api/auth/register'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
            return parseError(res);
        }
        const payload = await readJson<RawAuthResult>(res);
        return {
            userId: BigInt(payload.user_id),
            sessionToken: payload.session_token,
        };
    },

    async login(username: string, password: string): Promise<AuthResult> {
        const res = await fetch(resolveApiUrl('/api/auth/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
            return parseError(res);
        }
        const payload = await readJson<RawAuthResult>(res);
        return {
            userId: BigInt(payload.user_id),
            sessionToken: payload.session_token,
        };
    },

    async me(sessionToken: string): Promise<MeResult> {
        const res = await fetch(resolveApiUrl('/api/auth/me'), {
            method: 'GET',
            headers: authHeader(sessionToken),
        });
        if (!res.ok) {
            return parseError(res);
        }
        const payload = await readJson<RawMeResult>(res);
        return {
            userId: BigInt(payload.user_id),
            username: payload.username,
        };
    },

    async logout(sessionToken: string): Promise<void> {
        const res = await fetch(resolveApiUrl('/api/auth/logout'), {
            method: 'POST',
            headers: authHeader(sessionToken),
        });
        if (!res.ok && res.status !== 401) {
            return parseError(res);
        }
    },
};
