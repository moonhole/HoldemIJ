import { useEffect, useState } from 'react';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { auditApi, type AuditHandEvent, type AuditRecentHandItem } from '../../network/auditApi';
import { gameClient } from '../../network/GameClient';
import { decodeReplayServerTape, type ReplayServerTape } from '../../replay/replayCodec';
import { useReplayStore } from '../../replay/replayStore';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { AudioToggle } from '../common/AudioToggle';
import { NumberTicker } from '../common/NumberTicker';
import './lobby-overlay.css';

type LobbyTableItem = {
    name: string;
    blinds: string;
    pot: string;
    occupancy: string;
    fillPercent: number;
    tone: 'primary' | 'cyan' | 'neutral';
    dimmed?: boolean;
};

const MOCK_TABLES: LobbyTableItem[] = [
    {
        name: 'VOID_RUNNER_01',
        blinds: '$500 / $1,000',
        pot: '$45.2K',
        occupancy: '4 / 6 PLAYERS',
        fillPercent: 66,
        tone: 'primary',
    },
    {
        name: 'CHROME_HEAVEN',
        blinds: '$100 / $200',
        pot: '$8.9K',
        occupancy: '5 / 6 PLAYERS',
        fillPercent: 83,
        tone: 'cyan',
    },
    {
        name: 'NEON_GUTTER',
        blinds: '$25 / $50',
        pot: '$1.2K',
        occupancy: '2 / 6 PLAYERS',
        fillPercent: 33,
        tone: 'neutral',
        dimmed: true,
    },
    {
        name: 'GLITCH_PALACE',
        blinds: '$2K / $4K',
        pot: '$210K',
        occupancy: '6 / 6 FULL',
        fillPercent: 100,
        tone: 'primary',
    },
    {
        name: 'DATA_STREAM_B',
        blinds: '$50 / $100',
        pot: '$4.5K',
        occupancy: '3 / 6 PLAYERS',
        fillPercent: 50,
        tone: 'cyan',
    },
];

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
    const loadReplayTape = useReplayStore((s) => s.loadTape);
    const [auditOpen, setAuditOpen] = useState(false);
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

    if (currentScene !== 'lobby') {
        return null;
    }

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
                        <div className="lobby-credits">
                            <span className="lobby-label lobby-label-right">{username || 'Guest'}</span>
                            <span className="lobby-credits-value">
                                <span className="dollar">$</span> <NumberTicker value={1245900} />
                            </span>
                        </div>
                    </div>
                    <div className="lobby-filter-row">
                        <button type="button" className="lobby-filter-btn is-active" onClick={playUiClick}>
                            All Nodes
                        </button>
                        <button type="button" className="lobby-filter-btn" onClick={playUiClick}>
                            High Stakes
                        </button>
                        <button type="button" className="lobby-filter-btn" onClick={playUiClick}>
                            Speed
                        </button>
                    </div>
                </div>

                <div className="lobby-list">
                    {MOCK_TABLES.map((item) => (
                        <article
                            key={item.name}
                            className={`lobby-node tone-${item.tone}${item.dimmed ? ' is-dimmed' : ''}`}
                        >
                            <div className="lobby-node-main">
                                <div>
                                    <h3 className="lobby-node-title">{item.name}</h3>
                                    <p className="lobby-node-blind">Blind: {item.blinds}</p>
                                </div>
                                <div className="lobby-node-pot">
                                    <span className="lobby-node-pot-value">{item.pot}</span>
                                    <span className="lobby-node-pot-label">Pot</span>
                                </div>
                            </div>
                            <div className="lobby-node-occupancy-row">
                                <span className="lobby-node-occupancy-label">Occupancy</span>
                                <span className="lobby-node-occupancy-value">{item.occupancy}</span>
                            </div>
                            <div className="lobby-node-progress-bg">
                                <div className="lobby-node-progress" style={{ width: `${item.fillPercent}%` }} />
                            </div>
                        </article>
                    ))}
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
                    <div className="lobby-footer-row">
                        <button
                            type="button"
                            className="lobby-secondary-btn"
                            onClick={() => {
                                playUiClick();
                                setAuditOpen(true);
                            }}
                        >
                            <span className="material-symbols-outlined">history</span>
                            <span>Audit</span>
                        </button>
                        <button
                            type="button"
                            className="lobby-secondary-btn"
                            onClick={() => {
                                playUiClick();
                                void logout();
                                resetQuickStart();
                                requestScene('login');
                            }}
                        >
                            <span className="material-symbols-outlined">logout</span>
                            <span>Logout</span>
                        </button>
                        <button type="button" className="lobby-icon-btn" onClick={playUiClick}>
                            <span className="material-symbols-outlined">settings</span>
                        </button>
                    </div>
                    <div className="lobby-safe-bar" />
                    {quickStartError ? <div className="lobby-quick-start-error">{quickStartError}</div> : null}
                </div>

                {/* Floating Top Right Controls */}
                <div className="top-right-hud" style={{ position: 'absolute', top: '24px', right: '24px', pointerEvents: 'auto', zIndex: 100, display: 'flex', gap: '12px' }}>
                    <button type="button" className="lobby-icon-btn hud-btn chat-btn" onClick={playUiClick}>
                        <span className="material-symbols-outlined">chat_bubble</span>
                    </button>
                    <button type="button" className="lobby-icon-btn hud-btn settings-btn" onClick={playUiClick}>
                        <span className="material-symbols-outlined">settings</span>
                    </button>
                    <AudioToggle />
                </div>

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
