import { useEffect, useState } from 'react';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { auditApi, type AuditHandEvent, type AuditRecentHandItem } from '../../network/auditApi';
import { gameClient } from '../../network/GameClient';
import { decodeReplayServerTape, type ReplayServerTape } from '../../replay/replayCodec';
import { useReplayStore } from '../../replay/replayStore';
import { useAuthStore } from '../../store/authStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useUiStore } from '../../store/uiStore';
import { AudioToggle } from '../common/AudioToggle';
import { NumberTicker } from '../common/NumberTicker';
import './lobby-overlay.css';

type DesktopBridge = {
    isDesktop?: boolean;
    openGpuInfo?: () => Promise<boolean>;
};

function getDesktopBridge(): DesktopBridge | null {
    const host = globalThis as typeof globalThis & { desktopBridge?: DesktopBridge };
    return host.desktopBridge ?? null;
}




const LOBBY_WS_IDLE_DISCONNECT_MS = 30000;

function toHeroChair(summary: Record<string, unknown>): number {
    const raw = summary.chair;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.trunc(raw);
    }
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            return Math.trunc(parsed);
        }
    }
    return -1;
}

function toSignedDelta(summary: Record<string, unknown>): string {
    const raw = summary.delta;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return '--';
    }
    if (raw > 0) {
        return `+${raw}`;
    }
    return `${raw}`;
}

function buildReplayTape(handId: string, heroChair: number, events: AuditHandEvent[]): ReplayServerTape {
    return {
        tapeVersion: 1,
        tableId: `audit_${handId}`,
        heroChair,
        events: events.map((event) => ({
            type: event.eventType,
            seq: event.seq,
            envelopeB64: event.envelopeB64,
        })),
    };
}

export function LobbyOverlay(): JSX.Element | null {
    const currentScene = useUiStore((s) => s.currentScene);
    const quickStartPhase = useUiStore((s) => s.quickStartPhase);
    const quickStartLabel = useUiStore((s) => s.quickStartLabel);
    const quickStartError = useUiStore((s) => s.quickStartError);
    const startQuickStart = useUiStore((s) => s.startQuickStart);
    const resetQuickStart = useUiStore((s) => s.resetQuickStart);
    const requestScene = useUiStore((s) => s.requestScene);
    const username = useAuthStore((s) => s.username);
    const logout = useAuthStore((s) => s.logout);
    const uiProfile = useLayoutStore((s) => s.uiProfile);
    const loadReplayTape = useReplayStore((s) => s.loadTape);
    const [auditOpen, setAuditOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditError, setAuditError] = useState('');
    const [auditItems, setAuditItems] = useState<AuditRecentHandItem[]>([]);
    const [openingHandId, setOpeningHandId] = useState('');

    const playUiClick = (): void => {
        audioManager.play(SoundMap.UI_CLICK, 0.7);
    };

    useEffect(() => {
        if (!auditOpen) {
            return;
        }
        let cancelled = false;
        void (async () => {
            setAuditLoading(true);
            setAuditError('');
            try {
                const items = await auditApi.listRecent('live', 20);
                if (!cancelled) {
                    setAuditItems(items);
                }
            } catch (error) {
                if (!cancelled) {
                    setAuditError(error instanceof Error ? error.message : 'Failed to load audit');
                }
            } finally {
                if (!cancelled) {
                    setAuditLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [auditOpen]);

    useEffect(() => {
        if (!auditOpen) {
            return;
        }
        setSettingsOpen(false);
    }, [auditOpen]);

    useEffect(() => {
        if (currentScene !== 'lobby') {
            return;
        }
        const quickStartBusy = quickStartPhase === 'connecting' || quickStartPhase === 'sitting';
        if (quickStartBusy || !gameClient.isConnected) {
            return;
        }

        const timer = window.setTimeout(() => {
            const state = useUiStore.getState();
            const stillInLobby = state.currentScene === 'lobby';
            const stillBusy = state.quickStartPhase === 'connecting' || state.quickStartPhase === 'sitting';
            if (stillInLobby && !stillBusy && gameClient.isConnected) {
                gameClient.disconnect();
            }
        }, LOBBY_WS_IDLE_DISCONNECT_MS);

        return () => window.clearTimeout(timer);
    }, [currentScene, quickStartPhase]);

    if (currentScene !== 'lobby') {
        return null;
    }

    const desktopBridge = getDesktopBridge();
    const canOpenGpuInfo = desktopBridge?.isDesktop === true && typeof desktopBridge.openGpuInfo === 'function';

    const openAuditReplay = async (item: AuditRecentHandItem): Promise<void> => {
        setOpeningHandId(item.handId);
        setAuditError('');
        try {
            const events = await auditApi.getHand('live', item.handId);
            if (events.length === 0) {
                throw new Error('This hand has no replayable events');
            }
            const serverTape = buildReplayTape(item.handId, toHeroChair(item.summary), events);
            const tape = decodeReplayServerTape(serverTape);
            if (tape.events.length === 0) {
                throw new Error('No supported replay events found');
            }

            gameClient.disconnect();
            loadReplayTape(tape);
            setAuditOpen(false);
            requestScene('table');
        } catch (error) {
            setAuditError(error instanceof Error ? error.message : 'Failed to open replay');
        } finally {
            setOpeningHandId('');
        }
    };

    const busy = quickStartPhase === 'connecting' || quickStartPhase === 'sitting';

    return (
        <div className="lobby-screen">
            <div className="lobby-pixel-grid" />
            <div className="lobby-panel">
                <div className="lobby-header">
                    <div className="lobby-header-row">
                        <div className="lobby-net">
                            <span className="lobby-label">Neural Link</span>
                            <div className="lobby-net-status">
                                <span className="lobby-net-dot" />
                                <span className="lobby-net-text">STABLE_98.4%</span>
                            </div>
                        </div>
                        <div className="lobby-header-right">
                            <div className="lobby-credits">
                                <span className="lobby-label lobby-label-right">{username || 'Guest'}</span>
                                <span className="lobby-credits-value">
                                    <span className="dollar">$</span> <NumberTicker value={1245900} />
                                </span>
                            </div>
                            {uiProfile === 'compact' && (
                                <div className="lobby-header-actions">
                                    <button
                                        type="button"
                                        className="lobby-icon-btn"
                                        onClick={() => {
                                            playUiClick();
                                            setSettingsOpen((prev) => !prev);
                                        }}
                                        aria-label="Settings"
                                    >
                                        <span className="material-symbols-outlined">settings</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="lobby-icon-btn"
                                        onClick={async () => {
                                            playUiClick();
                                            await logout();
                                            resetQuickStart();
                                            requestScene('login');
                                        }}
                                        aria-label="Logout"
                                    >
                                        <span className="material-symbols-outlined">logout</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="lobby-list">
                    {/* Story Mode Card */}
                    <section className="lobby-story-card">
                        <div className="lobby-story-card-header">
                            <div className="lobby-story-card-icon">
                                <span className="material-symbols-outlined">auto_stories</span>
                            </div>
                            <div>
                                <h3 className="lobby-story-card-title">STORY MODE</h3>
                                <p className="lobby-story-card-desc">
                                    Challenge 5 unique opponents at the 6-max table. Defeat each chapter boss,
                                    unlock new abilities, and master the game.
                                </p>
                            </div>
                        </div>
                        <div className="lobby-story-chapters">
                            <div className="lobby-story-chapter">
                                <span className="lobby-story-ch-num">I</span>
                                <span className="lobby-story-ch-name">NEON GUTTER</span>
                            </div>
                            <div className="lobby-story-chapter is-locked">
                                <span className="lobby-story-ch-num">II</span>
                                <span className="lobby-story-ch-name">CHROME HEAVEN</span>
                            </div>
                            <div className="lobby-story-chapter is-locked">
                                <span className="lobby-story-ch-num">III</span>
                                <span className="lobby-story-ch-name">VOID RUNNER</span>
                            </div>
                            <div className="lobby-story-chapter is-locked">
                                <span className="lobby-story-ch-num">IV</span>
                                <span className="lobby-story-ch-name">GLITCH PALACE</span>
                            </div>
                            <div className="lobby-story-chapter is-locked">
                                <span className="lobby-story-ch-num">V</span>
                                <span className="lobby-story-ch-name">DATA STREAM</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="lobby-story-play-btn"
                            onClick={() => playUiClick()}
                        >
                            <span className="material-symbols-outlined">play_arrow</span>
                            <span>BEGIN CHAPTER I</span>
                        </button>
                    </section>

                    {/* Audit Feature Card */}
                    <section className="lobby-audit-card">
                        <div className="lobby-audit-card-header">
                            <div className="lobby-audit-card-icon">
                                <span className="material-symbols-outlined">history</span>
                            </div>
                            <div>
                                <h3 className="lobby-audit-card-title">HAND AUDIT</h3>
                                <p className="lobby-audit-card-desc">Review your recent hands, analyze decisions, and replay key moments.</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="lobby-audit-open-btn"
                            onClick={() => {
                                playUiClick();
                                setAuditOpen(true);
                            }}
                        >
                            <span className="material-symbols-outlined">play_arrow</span>
                            <span>OPEN AUDIT CONSOLE</span>
                        </button>
                        {auditItems.length > 0 && !auditOpen && (
                            <div className="lobby-audit-preview">
                                <span className="lobby-audit-preview-label">{auditItems.length} recent hand{auditItems.length !== 1 ? 's' : ''} available</span>
                            </div>
                        )}
                    </section>

                    {/* Agent Coach Card */}
                    <section className="lobby-feature-card">
                        <div className="lobby-feature-card-header">
                            <div className="lobby-feature-card-icon tone-magenta">
                                <span className="material-symbols-outlined">psychology</span>
                            </div>
                            <div>
                                <h3 className="lobby-feature-card-title">AGENT COACH</h3>
                                <p className="lobby-feature-card-desc">AI-powered real-time coaching. Get instant feedback on your decisions and improve your game.</p>
                            </div>
                        </div>
                        <div className="lobby-feature-card-badge">Coming Soon</div>
                    </section>

                    {/* Agent UI Programming Card */}
                    <section className="lobby-feature-card">
                        <div className="lobby-feature-card-header">
                            <div className="lobby-feature-card-icon tone-purple">
                                <span className="material-symbols-outlined">code</span>
                            </div>
                            <div>
                                <h3 className="lobby-feature-card-title">AGENT UI PROGRAMMING</h3>
                                <p className="lobby-feature-card-desc">Build custom interfaces and automation scripts with natural language. Let the agent code your poker HUD.</p>
                            </div>
                        </div>
                        <div className="lobby-feature-card-badge">Coming Soon</div>
                    </section>

                    {/* Invite Friends Card */}
                    <section className="lobby-feature-card">
                        <div className="lobby-feature-card-header">
                            <div className="lobby-feature-card-icon tone-green">
                                <span className="material-symbols-outlined">group_add</span>
                            </div>
                            <div>
                                <h3 className="lobby-feature-card-title">INVITE FRIENDS</h3>
                                <p className="lobby-feature-card-desc">Create a private table and invite friends for a multiplayer session. Play together in real-time.</p>
                            </div>
                        </div>
                        <div className="lobby-feature-card-badge">Coming Soon</div>
                    </section>
                </div>

                <div className="lobby-footer">
                    <button
                        className="lobby-quick-join-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            playUiClick();
                            void startQuickStart();
                        }}
                    >
                        <span className="material-symbols-outlined">bolt</span>
                        <span>{quickStartLabel}</span>
                    </button>
                    {quickStartError ? <div className="lobby-quick-start-error">{quickStartError}</div> : null}
                </div>

                {settingsOpen ? (
                    <div
                        className="settings-modal-backdrop"
                        onClick={() => {
                            playUiClick();
                            setSettingsOpen(false);
                        }}
                    >
                        <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
                            <header className="settings-modal-header">
                                <h3>SETTINGS</h3>
                                <button
                                    type="button"
                                    className="settings-close-btn"
                                    onClick={() => {
                                        playUiClick();
                                        setSettingsOpen(false);
                                    }}
                                >
                                    CLOSE
                                </button>
                            </header>
                            <div className="settings-item-row">
                                <span className="settings-item-label">Audio</span>
                                <AudioToggle />
                            </div>
                            {canOpenGpuInfo ? (
                                <div className="settings-item-row">
                                    <span className="settings-item-label">Help</span>
                                    <button
                                        type="button"
                                        className="settings-action-btn"
                                        onClick={() => {
                                            playUiClick();
                                            void desktopBridge.openGpuInfo?.();
                                        }}
                                    >
                                        GPU INFO
                                    </button>
                                </div>
                            ) : null}
                        </section>
                    </div>
                ) : null}

                {auditOpen ? (
                    <div className="audit-modal-backdrop">
                        <section className="audit-modal" aria-label="audit recent hands">
                            <header className="audit-modal-header">
                                <h3>AUDIT / RECENT HANDS</h3>
                                <button
                                    type="button"
                                    className="audit-close-btn"
                                    onClick={() => {
                                        playUiClick();
                                        setAuditOpen(false);
                                    }}
                                >
                                    CLOSE
                                </button>
                            </header>

                            {auditLoading ? <div className="audit-state">Loading...</div> : null}
                            {!auditLoading && auditItems.length === 0 ? (
                                <div className="audit-state">No hands yet.</div>
                            ) : null}
                            {!auditLoading && auditItems.length > 0 ? (
                                <div className="audit-list">
                                    {auditItems.map((item) => (
                                        <article key={item.handId} className="audit-item">
                                            <div className="audit-item-row">
                                                <div>
                                                    <div className="audit-hand-id">{item.handId}</div>
                                                    <div className="audit-hand-meta">
                                                        {new Date(item.playedAt).toLocaleString()}
                                                    </div>
                                                </div>
                                                <div className={`audit-delta ${toSignedDelta(item.summary).startsWith('+') ? 'is-pos' : 'is-neg'}`}>
                                                    {toSignedDelta(item.summary)}
                                                </div>
                                            </div>
                                            <div className="audit-item-row">
                                                <span className="audit-hand-meta">
                                                    Chair: {toHeroChair(item.summary)}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="audit-replay-btn"
                                                    disabled={openingHandId === item.handId}
                                                    onClick={() => {
                                                        playUiClick();
                                                        void openAuditReplay(item);
                                                    }}
                                                >
                                                    {openingHandId === item.handId ? 'OPENING...' : 'OPEN REPLAY'}
                                                </button>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : null}
                            {auditError ? <div className="audit-error">{auditError}</div> : null}
                        </section>
                    </div>
                ) : null}
                <div className="lobby-scanline" />
            </div>
        </div>
    );
}
