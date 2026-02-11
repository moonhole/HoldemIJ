import { create } from 'zustand';
import { AuthApiError, authApi } from '../network/authApi';
import { gameClient } from '../network/GameClient';

export type AuthPhase = 'checking' | 'unauthenticated' | 'submitting' | 'authenticated';

type AuthStoreState = {
    phase: AuthPhase;
    userId: bigint;
    username: string;
    errorMessage: string;

    bootstrap: () => Promise<boolean>;
    login: (username: string, password: string) => Promise<boolean>;
    register: (username: string, password: string) => Promise<boolean>;
    logout: () => Promise<void>;
    clearError: () => void;
};

function toErrorMessage(error: unknown): string {
    if (error instanceof AuthApiError) {
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Request failed';
}

export const useAuthStore = create<AuthStoreState>((set) => ({
    phase: 'checking',
    userId: 0n,
    username: '',
    errorMessage: '',

    bootstrap: async () => {
        const token = gameClient.getSessionToken();
        if (!token) {
            set((state) => ({
                ...state,
                phase: 'unauthenticated',
                userId: 0n,
                username: '',
                errorMessage: '',
            }));
            return false;
        }

        set((state) => ({ ...state, phase: 'checking', errorMessage: '' }));
        try {
            const profile = await authApi.me(token);
            set((state) => ({
                ...state,
                phase: 'authenticated',
                userId: profile.userId,
                username: profile.username,
                errorMessage: '',
            }));
            return true;
        } catch {
            gameClient.clearSessionToken();
            set((state) => ({
                ...state,
                phase: 'unauthenticated',
                userId: 0n,
                username: '',
                errorMessage: '',
            }));
            return false;
        }
    },

    login: async (username, password) => {
        set((state) => ({ ...state, phase: 'submitting', errorMessage: '' }));
        try {
            const result = await authApi.login(username, password);
            gameClient.setSessionToken(result.sessionToken);
            set((state) => ({
                ...state,
                phase: 'authenticated',
                userId: result.userId,
                username: username.trim().toLowerCase(),
                errorMessage: '',
            }));
            return true;
        } catch (error) {
            set((state) => ({
                ...state,
                phase: 'unauthenticated',
                userId: 0n,
                username: '',
                errorMessage: toErrorMessage(error),
            }));
            return false;
        }
    },

    register: async (username, password) => {
        set((state) => ({ ...state, phase: 'submitting', errorMessage: '' }));
        try {
            const result = await authApi.register(username, password);
            gameClient.setSessionToken(result.sessionToken);
            set((state) => ({
                ...state,
                phase: 'authenticated',
                userId: result.userId,
                username: username.trim().toLowerCase(),
                errorMessage: '',
            }));
            return true;
        } catch (error) {
            set((state) => ({
                ...state,
                phase: 'unauthenticated',
                userId: 0n,
                username: '',
                errorMessage: toErrorMessage(error),
            }));
            return false;
        }
    },

    logout: async () => {
        const token = gameClient.getSessionToken();
        if (token) {
            try {
                await authApi.logout(token);
            } catch {
                // Ignore network errors on local logout.
            }
        }
        gameClient.disconnect();
        gameClient.clearSessionToken();
        set((state) => ({
            ...state,
            phase: 'unauthenticated',
            userId: 0n,
            username: '',
            errorMessage: '',
        }));
    },

    clearError: () =>
        set((state) => ({
            ...state,
            errorMessage: '',
        })),
}));

export async function bootstrapAuthSession(): Promise<boolean> {
    return useAuthStore.getState().bootstrap();
}
