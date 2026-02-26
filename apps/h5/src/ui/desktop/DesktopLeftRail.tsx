import { Phase } from '@gen/messages_pb';
import { useMemo } from 'react';
import { useReplayStore } from '../../replay/replayStore';
import { useAuthStore } from '../../store/authStore';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';

function phaseLabel(phase: Phase | undefined): string {
    switch (phase) {
        case Phase.PREFLOP:
            return 'Preflop';
        case Phase.FLOP:
            return 'Flop';
        case Phase.TURN:
            return 'Turn';
        case Phase.RIVER:
            return 'River';
        case Phase.SHOWDOWN:
            return 'Showdown';
        default:
            return '--';
    }
}

function formatChips(value: bigint): string {
    return `$${value.toLocaleString()}`;
}

/* ── Login Scene ── */
function LoginLeftRail(): JSX.Element {
    return (
        <aside className="desktop-left-rail-content">
            <div className="left-rail-brand">
                <div className="left-rail-brand-icon">
                    <span className="material-symbols-outlined">casino</span>
                </div>
                <h1 className="left-rail-brand-title">HoldemIJ</h1>
                <p className="left-rail-brand-tagline">AI-Powered Poker Training Platform</p>
            </div>

            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">Platform Highlights</span>
                </header>
                <div className="left-rail-features">
                    <div className="left-rail-feature-item">
                        <span className="material-symbols-outlined left-rail-feature-icon tone-cyan">psychology</span>
                        <div>
                            <span className="left-rail-feature-name">AI Coach</span>
                            <span className="left-rail-feature-detail">Real-time decision analysis</span>
                        </div>
                    </div>
                    <div className="left-rail-feature-item">
                        <span className="material-symbols-outlined left-rail-feature-icon tone-magenta">history</span>
                        <div>
                            <span className="left-rail-feature-name">Hand Audit</span>
                            <span className="left-rail-feature-detail">Replay &amp; review every hand</span>
                        </div>
                    </div>
                    <div className="left-rail-feature-item">
                        <span className="material-symbols-outlined left-rail-feature-icon tone-purple">code</span>
                        <div>
                            <span className="left-rail-feature-name">Agent Programming</span>
                            <span className="left-rail-feature-detail">Build custom HUD with AI</span>
                        </div>
                    </div>
                    <div className="left-rail-feature-item">
                        <span className="material-symbols-outlined left-rail-feature-icon tone-green">group</span>
                        <div>
                            <span className="left-rail-feature-name">Multiplayer</span>
                            <span className="left-rail-feature-detail">Invite friends to play</span>
                        </div>
                    </div>
                </div>
            </section>

            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">System</span>
                </header>
                <div className="desktop-rail-grid">
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Version</span>
                        <span className="desktop-rail-value">0.1.0</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Build</span>
                        <span className="desktop-rail-value">Desktop</span>
                    </div>
                </div>
            </section>
        </aside>
    );
}

/* ── Lobby Scene ── */
function LobbyLeftRail(): JSX.Element {
    const username = useAuthStore((s) => s.username);

    return (
        <aside className="desktop-left-rail-content">
            <section className="desktop-rail-card left-rail-profile-card">
                <div className="left-rail-avatar">
                    <span className="material-symbols-outlined">person</span>
                </div>
                <div className="left-rail-profile-info">
                    <span className="left-rail-profile-name">{username || 'Guest'}</span>
                    <span className="left-rail-profile-rank">Rank: Unranked</span>
                </div>
            </section>

            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">Session Summary</span>
                    <span className="desktop-rail-chip">Today</span>
                </header>
                <div className="desktop-rail-grid">
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Hands Played</span>
                        <span className="desktop-rail-value">--</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Win Rate</span>
                        <span className="desktop-rail-value">--</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Net P/L</span>
                        <span className="desktop-rail-value">--</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Best Hand</span>
                        <span className="desktop-rail-value">--</span>
                    </div>
                </div>
            </section>

            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">Training Goal</span>
                    <span className="desktop-rail-chip">Phase 1</span>
                </header>
                <ul className="desktop-rail-list">
                    <li className="desktop-rail-list-item">Value bet windows on turn/river</li>
                    <li className="desktop-rail-list-item">Avoid over-bluff against calling stations</li>
                    <li className="desktop-rail-list-item">Track SPR before committing stacks</li>
                </ul>
            </section>

            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">Quick Tips</span>
                </header>
                <div className="desktop-rail-note">
                    💡 Review your last session's hands in the Audit console to identify patterns in your play.
                </div>
            </section>
        </aside>
    );
}

/* ── Table / Audit Scene ── */
function TableLeftRail(): JSX.Element {
    const currentScene = useUiStore((s) => s.currentScene);
    const replayMode = useReplayStore((s) => s.mode);
    const replayTape = useReplayStore((s) => s.tape);
    const replayCursor = useReplayStore((s) => s.cursor);
    const replayVisualSteps = useReplayStore((s) => s.visualSteps);

    const snapshot = useGameStore((s) => s.snapshot);
    const myChair = useGameStore((s) => s.myChair);

    const tablePot = useMemo(() => {
        if (!snapshot) {
            return 0n;
        }
        return snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0n);
    }, [snapshot]);

    const opponentRows = useMemo(() => {
        if (!snapshot) {
            return [];
        }
        return snapshot.players
            .filter((player) => player.chair !== myChair)
            .slice(0, 6)
            .map((player) => ({
                id: player.userId,
                seat: player.chair,
                name: player.nickname || `Seat ${player.chair}`,
                stack: player.stack,
                folded: player.folded,
                allIn: player.allIn,
            }));
    }, [snapshot, myChair]);

    const replayStepLabel = replayMode === 'loaded'
        ? `${Math.max(0, replayCursor + 1)} / ${replayVisualSteps.length}`
        : '--';

    const isReplayReady = currentScene === 'table' && replayMode === 'loaded';

    return (
        <aside className="desktop-left-rail-content">
            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">Explanation Console</span>
                    <span className={`desktop-rail-chip ${isReplayReady ? 'is-live' : ''}`}>
                        {isReplayReady ? 'Ready' : 'Standby'}
                    </span>
                </header>
                <div className="desktop-rail-grid">
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Scene</span>
                        <span className="desktop-rail-value">{currentScene}</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Replay Mode</span>
                        <span className="desktop-rail-value">{replayMode}</span>
                    </div>
                </div>
            </section>

            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">Hand Navigator</span>
                    <span className={`desktop-rail-chip ${replayMode === 'loaded' ? 'is-live' : ''}`}>
                        {replayMode === 'loaded' ? 'Replay' : 'Idle'}
                    </span>
                </header>
                <div className="desktop-rail-grid">
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Visual Steps</span>
                        <span className="desktop-rail-value">{replayStepLabel}</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Raw Events</span>
                        <span className="desktop-rail-value">{replayTape?.events.length ?? 0}</span>
                    </div>
                </div>
                <div className="desktop-rail-note">Bookmarks and branch marks will be added in next pass.</div>
            </section>

            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">Table Snapshot</span>
                    <span className="desktop-rail-chip">{currentScene === 'table' ? 'Table' : 'Lobby'}</span>
                </header>
                <div className="desktop-rail-grid">
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Phase</span>
                        <span className="desktop-rail-value">{phaseLabel(snapshot?.phase)}</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Pot</span>
                        <span className="desktop-rail-value">{formatChips(tablePot)}</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Seats</span>
                        <span className="desktop-rail-value">{snapshot?.players.length ?? 0}/6</span>
                    </div>
                    <div className="desktop-rail-metric">
                        <span className="desktop-rail-label">Hero Chair</span>
                        <span className="desktop-rail-value">{myChair >= 0 ? myChair : '--'}</span>
                    </div>
                </div>
            </section>

            <section className="desktop-rail-card">
                <header className="desktop-rail-head">
                    <span className="desktop-rail-title">Opponent Cards</span>
                    <span className="desktop-rail-chip">Profile</span>
                </header>
                {opponentRows.length === 0 ? (
                    <div className="desktop-rail-empty">No active opponents in current snapshot.</div>
                ) : (
                    <div className="desktop-rail-opponents">
                        {opponentRows.map((opponent) => (
                            <div key={`${opponent.id.toString()}_${opponent.seat}`} className="desktop-opp-row">
                                <div className="desktop-opp-main">
                                    <span className="desktop-opp-name">{opponent.name}</span>
                                    <span className="desktop-opp-seat">Seat {opponent.seat}</span>
                                </div>
                                <div className="desktop-opp-side">
                                    <span className="desktop-opp-stack">{formatChips(opponent.stack)}</span>
                                    <span className={`desktop-opp-state ${opponent.allIn ? 'is-alert' : ''}`}>
                                        {opponent.allIn ? 'All-In' : opponent.folded ? 'Folded' : 'Active'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </aside>
    );
}

/* ── Router ── */
export function DesktopLeftRail(): JSX.Element {
    const currentScene = useUiStore((s) => s.currentScene);

    if (currentScene === 'login') {
        return <LoginLeftRail />;
    }
    if (currentScene === 'lobby') {
        return <LobbyLeftRail />;
    }
    return <TableLeftRail />;
}
