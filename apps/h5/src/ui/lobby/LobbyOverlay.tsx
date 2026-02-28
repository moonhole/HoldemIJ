import { useEffect, useState } from 'react';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { auditApi, type AuditHandEvent, type AuditRecentHandItem } from '../../network/auditApi';
import { gameClient } from '../../network/GameClient';
import { decodeReplayServerTape, type ReplayServerTape } from '../../replay/replayCodec';
import { useReplayStore } from '../../replay/replayStore';
import {
    getStoryFeatureMeta,
    STORY_CHAPTERS,
    storyChapterRoman,
} from '../../story/storyCatalog';
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
    const startStoryChapter = useUiStore((s) => s.startStoryChapter);
    const resumePausedStory = useUiStore((s) => s.resumePausedStory);
    const restartStoryChapter = useUiStore((s) => s.restartStoryChapter);
    const setSelectedStoryChapter = useUiStore((s) => s.setSelectedStoryChapter);
    const selectedStoryChapter = useUiStore((s) => s.selectedStoryChapter);
    const storyHighestUnlockedChapter = useUiStore((s) => s.storyHighestUnlockedChapter);
    const storyCompletedChapters = useUiStore((s) => s.storyCompletedChapters);
    const storyUnlockedFeatures = useUiStore((s) => s.storyUnlockedFeatures);
    const pausedStoryInstance = useUiStore((s) => s.pausedStoryInstance);
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
        if (gameClient.isConnected) {
            return;
        }
        if (quickStartPhase === 'connecting' || quickStartPhase === 'sitting') {
            return;
        }
        void gameClient.connect().catch((error) => {
            console.warn('[LobbyOverlay] Failed to prefetch story progress', error);
        });
    }, [currentScene, quickStartPhase]);

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
    const selectedChapterMeta = STORY_CHAPTERS.find((chapter) => chapter.id === selectedStoryChapter) ?? STORY_CHAPTERS[0];
    const pausedChapterMeta =
        pausedStoryInstance
            ? STORY_CHAPTERS.find((chapter) => chapter.id === pausedStoryInstance.chapterId) ?? null
            : null;
    const canResumePausedStory =
        !!pausedStoryInstance &&
        pausedStoryInstance.chapterId > 0 &&
        pausedStoryInstance.chapterId <= storyHighestUnlockedChapter;
    const hasHandAudit = storyUnlockedFeatures.includes('hand_audit');
    const hasAgentCoach = storyUnlockedFeatures.includes('agent_coach');
    const hasAgentUiProgramming = storyUnlockedFeatures.includes('agent_ui_programming');
    const hasInviteFriends = storyUnlockedFeatures.includes('invite_friends');

    const lockHint = (featureId: string): string => {
        const meta = getStoryFeatureMeta(featureId);
        if (!meta) {
            return 'LOCKED';
        }
        return `LOCKED - CLEAR CHAPTER ${storyChapterRoman(meta.chapterUnlocked)}`;
    };

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
                            {STORY_CHAPTERS.map((chapter) => {
                                const isUnlocked = chapter.id <= storyHighestUnlockedChapter;
                                const isCompleted = storyCompletedChapters.includes(chapter.id);
                                const isSelected = selectedStoryChapter === chapter.id;
                                const classNames = ['lobby-story-chapter'];
                                if (!isUnlocked) classNames.push('is-locked');
                                if (isCompleted) classNames.push('is-completed');
                                if (isSelected) classNames.push('is-selected');
                                return (
                                    <button
                                        key={chapter.id}
                                        type="button"
                                        className={classNames.join(' ')}
                                        disabled={!isUnlocked}
                                        onClick={() => {
                                            playUiClick();
                                            setSelectedStoryChapter(chapter.id);
                                        }}
                                    >
                                        <span className="lobby-story-ch-num">{chapter.roman}</span>
                                        <span className="lobby-story-ch-name">{chapter.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {pausedStoryInstance ? (
                            <div className="lobby-story-paused-wrap">
                                <div className="lobby-story-paused-hint">
                                    {`Paused session: Chapter ${pausedChapterMeta?.roman ?? pausedStoryInstance.chapterId}`}
                                </div>
                                <div className="lobby-story-paused-actions">
                                    <button
                                        type="button"
                                        className="lobby-story-play-btn is-resume"
                                        disabled={busy || !canResumePausedStory}
                                        onClick={() => {
                                            playUiClick();
                                            void resumePausedStory();
                                        }}
                                    >
                                        <span className="material-symbols-outlined">play_arrow</span>
                                        <span>{`RESUME CHAPTER ${pausedChapterMeta?.roman ?? pausedStoryInstance.chapterId}`}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="lobby-story-restart-btn"
                                        disabled={busy || selectedStoryChapter > storyHighestUnlockedChapter}
                                        onClick={() => {
                                            playUiClick();
                                            void restartStoryChapter(selectedStoryChapter);
                                        }}
                                    >
                                        <span className="material-symbols-outlined">restart_alt</span>
                                        <span>{`RESTART CHAPTER ${selectedChapterMeta.roman}`}</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                className="lobby-story-play-btn"
                                disabled={busy || selectedStoryChapter > storyHighestUnlockedChapter}
                                onClick={() => {
                                    playUiClick();
                                    void startStoryChapter(selectedStoryChapter, 'start');
                                }}
                            >
                                <span className="material-symbols-outlined">play_arrow</span>
                                <span>{`ENTER CHAPTER ${selectedChapterMeta.roman}`}</span>
                            </button>
                        )}
                    </section>

                    {/* Audit Feature Card */}
                    <section className={`lobby-audit-card ${hasHandAudit ? '' : 'is-locked'}`}>
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
                            disabled={!hasHandAudit}
                            onClick={() => {
                                if (!hasHandAudit) {
                                    return;
                                }
                                playUiClick();
                                setAuditOpen(true);
                            }}
                        >
                            <span className="material-symbols-outlined">play_arrow</span>
                            <span>{hasHandAudit ? 'OPEN AUDIT CONSOLE' : lockHint('hand_audit')}</span>
                        </button>
                        {hasHandAudit && auditItems.length > 0 && !auditOpen && (
                            <div className="lobby-audit-preview">
                                <span className="lobby-audit-preview-label">{auditItems.length} recent hand{auditItems.length !== 1 ? 's' : ''} available</span>
                            </div>
                        )}
                    </section>

                    {/* Agent Coach Card */}
                    <section className={`lobby-feature-card ${hasAgentCoach ? 'is-unlocked' : 'is-locked'}`}>
                        <div className="lobby-feature-card-header">
                            <div className="lobby-feature-card-icon tone-magenta">
                                <span className="material-symbols-outlined">psychology</span>
                            </div>
                            <div>
                                <h3 className="lobby-feature-card-title">AGENT COACH</h3>
                                <p className="lobby-feature-card-desc">AI-powered real-time coaching. Get instant feedback on your decisions and improve your game.</p>
                            </div>
                        </div>
                        <div className="lobby-feature-card-badge">
                            {hasAgentCoach ? 'UNLOCKED - COMING SOON' : lockHint('agent_coach')}
                        </div>
                    </section>

                    {/* Agent UI Programming Card */}
                    <section className={`lobby-feature-card ${hasAgentUiProgramming ? 'is-unlocked' : 'is-locked'}`}>
                        <div className="lobby-feature-card-header">
                            <div className="lobby-feature-card-icon tone-purple">
                                <span className="material-symbols-outlined">code</span>
                            </div>
                            <div>
                                <h3 className="lobby-feature-card-title">AGENT UI PROGRAMMING</h3>
                                <p className="lobby-feature-card-desc">Build custom interfaces and automation scripts with natural language. Let the agent code your poker HUD.</p>
                            </div>
                        </div>
                        <div className="lobby-feature-card-badge">
                            {hasAgentUiProgramming ? 'UNLOCKED - COMING SOON' : lockHint('agent_ui_programming')}
                        </div>
                    </section>

                    {/* Invite Friends Card */}
                    <section className={`lobby-feature-card ${hasInviteFriends ? 'is-unlocked' : 'is-locked'}`}>
                        <div className="lobby-feature-card-header">
                            <div className="lobby-feature-card-icon tone-green">
                                <span className="material-symbols-outlined">group_add</span>
                            </div>
                            <div>
                                <h3 className="lobby-feature-card-title">INVITE FRIENDS</h3>
                                <p className="lobby-feature-card-desc">Create a private table and invite friends for a multiplayer session. Play together in real-time.</p>
                            </div>
                        </div>
                        <div className="lobby-feature-card-badge">
                            {hasInviteFriends ? 'UNLOCKED - COMING SOON' : lockHint('invite_friends')}
                        </div>
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
