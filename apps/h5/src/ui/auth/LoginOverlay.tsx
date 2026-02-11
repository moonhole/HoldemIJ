import { FormEvent, useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import './login-overlay.css';

type AuthMode = 'login' | 'register';

export function LoginOverlay(): JSX.Element | null {
    const currentScene = useUiStore((s) => s.currentScene);
    const requestScene = useUiStore((s) => s.requestScene);
    const phase = useAuthStore((s) => s.phase);
    const errorMessage = useAuthStore((s) => s.errorMessage);
    const login = useAuthStore((s) => s.login);
    const register = useAuthStore((s) => s.register);
    const clearError = useAuthStore((s) => s.clearError);

    const [mode, setMode] = useState<AuthMode>('login');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    useEffect(() => {
        if (phase === 'authenticated' && currentScene === 'login') {
            requestScene('lobby');
        }
    }, [phase, currentScene, requestScene]);

    if (currentScene !== 'login') {
        return null;
    }

    const isBusy = phase === 'checking' || phase === 'submitting';
    const title = mode === 'login' ? 'Sign In' : 'Create Account';
    const submitLabel = mode === 'login' ? 'Login' : 'Register';
    const switchLabel = mode === 'login' ? 'Need an account? Register' : 'Already have an account? Login';

    const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        clearError();
        const name = username.trim();
        if (!name || !password) {
            return;
        }

        const ok = mode === 'login'
            ? await login(name, password)
            : await register(name, password);
        if (ok) {
            requestScene('lobby');
        }
    };

    return (
        <div className="login-screen">
            <form className="login-card" onSubmit={onSubmit}>
                <h1 className="login-title">{title}</h1>
                <p className="login-hint">MVP debug login for local development</p>

                <label className="login-label" htmlFor="username-input">Username</label>
                <input
                    id="username-input"
                    className="login-input"
                    value={username}
                    autoComplete="username"
                    disabled={isBusy}
                    onChange={(e) => {
                        if (errorMessage) clearError();
                        setUsername(e.target.value);
                    }}
                />

                <label className="login-label" htmlFor="password-input">Password</label>
                <input
                    id="password-input"
                    className="login-input"
                    type="password"
                    value={password}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    disabled={isBusy}
                    onChange={(e) => {
                        if (errorMessage) clearError();
                        setPassword(e.target.value);
                    }}
                />

                <button className="login-submit" type="submit" disabled={isBusy}>
                    {isBusy ? 'Please wait...' : submitLabel}
                </button>

                <button
                    className="login-switch"
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                        clearError();
                        setMode((prev) => (prev === 'login' ? 'register' : 'login'));
                    }}
                >
                    {switchLabel}
                </button>

                {errorMessage ? <div className="login-error">{errorMessage}</div> : null}
            </form>
        </div>
    );
}
