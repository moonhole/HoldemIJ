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
    const [isGlitching, setIsGlitching] = useState(false);

    useEffect(() => {
        if (phase === 'authenticated' && currentScene === 'login') {
            requestScene('lobby');
        }
    }, [phase, currentScene, requestScene]);

    useEffect(() => {
        if (currentScene === 'login') {
            setIsGlitching(false);
        }
    }, [currentScene]);

    if (currentScene !== 'login') {
        return null;
    }

    const isBusy = phase === 'checking' || phase === 'submitting';
    const submitLabel = mode === 'login' ? 'Initialize Login' : 'Register Uplink';

    const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        console.log('[Login] Submitting...', { username, mode });
        clearError();
        const name = username.trim();
        if (!name || !password) {
            console.log('[Login] Validation failed: missing name or password');
            return;
        }

        // Trigger glitch effect before/during submission
        setIsGlitching(true);
        console.log('[Login] Triggering glitch...');
        (window as any).__TRIGGER_LOGIN_GLITCH?.();

        console.log('[Login] Calling auth store...');
        const ok = mode === 'login'
            ? await login(name, password)
            : await register(name, password);

        console.log('[Login] Auth result:', ok);
        if (ok) {
            requestScene('lobby');
        } else {
            setIsGlitching(false);
        }
    };

    return (
        <div className="login-screen">
            {/* Decotative Text Corners */}
            <div className="login-deco-text login-deco-tl">
                <p>SYSTEM_STATUS: <span className="login-pulse">OK</span></p>
                <p>UPTIME: 99.98%</p>
            </div>
            <div className="login-deco-text login-deco-tr">
                <p>ENCRYPTION: AES-256</p>
                <p>UPLINK_ID: CT-9920</p>
            </div>
            <div className="login-deco-text login-deco-bl">
                <p>IP_TRACE: REDACTED</p>
                <p>LOC: OLYMPUS_HUB</p>
            </div>
            <div className="login-deco-text login-deco-br">
                <p>© 2024 CYBER_NETICS</p>
                <p>RE_ENTRY_POINT: 0x4F2A</p>
            </div>

            <div className="login-card">
                {/* Logo Section */}
                <div className="login-logo-container">
                    <div className="logo-glow"></div>
                    <div className="logo-inner">
                        <div className="logo-center">
                            <span className="material-symbols-outlined logo-icon">token</span>
                        </div>
                    </div>
                </div>

                {/* Form Section */}
                <form className="login-form" onSubmit={onSubmit}>
                    <div className="input-group">
                        <label className="input-label">Neural ID</label>
                        <div className="input-wrapper">
                            <input
                                className="login-input"
                                placeholder="USERNAME_SEQUENCE"
                                value={username}
                                autoComplete="username"
                                disabled={isBusy}
                                onChange={(e) => {
                                    if (errorMessage) clearError();
                                    setUsername(e.target.value);
                                }}
                            />
                            <span className="material-symbols-outlined input-icon">fingerprint</span>
                        </div>
                    </div>

                    <div className="input-group">
                        <label className="input-label">Access Key</label>
                        <div className="input-wrapper">
                            <input
                                className="login-input"
                                type="password"
                                placeholder="********"
                                value={password}
                                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                disabled={isBusy}
                                onChange={(e) => {
                                    if (errorMessage) clearError();
                                    setPassword(e.target.value);
                                }}
                            />
                            <span className="material-symbols-outlined input-icon">lock_open</span>
                        </div>
                    </div>

                    <button
                        className={`login-submit ${isGlitching ? 'glitch-active' : ''}`}
                        type="submit"
                        disabled={isBusy}
                    >
                        {isBusy ? 'Processing...' : submitLabel}
                    </button>
                </form>

                {/* Switch Links */}
                <div className="login-links">
                    <div className="login-link" onClick={() => {
                        clearError();
                        setMode(mode === 'login' ? 'register' : 'login');
                    }}>
                        <span></span>
                        {mode === 'login' ? 'New Uplink' : 'Existing Link'}
                    </div>
                    <div className="login-link magenta" onClick={() => clearError()}>
                        <span></span>
                        Recover ID
                    </div>
                </div>
            </div>

            {errorMessage ? <div className="login-error">ACCESS_DENIED: {errorMessage}</div> : null}

            <div style={{
                position: 'absolute',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '1px',
                height: '48px',
                background: 'linear-gradient(to top, transparent, rgba(0, 243, 255, 0.2), transparent)'
            }}></div>
        </div>
    );
}
