import { ActionType } from '@gen/messages_pb';
import { useEffect, useMemo, useRef, useState } from 'react';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { gameClient } from '../../network/GameClient';
import { useReiStore } from '../../rei/reiStore';
import { useReplayStore } from '../../replay/replayStore';
import { useGameStore } from '../../store/gameStore';
import { useLiveUiStore } from '../../store/liveUiStore';
import { useUiStore } from '../../store/uiStore';
import { NumberTicker } from '../common/NumberTicker';
import './action-overlay.css';

function sumPots(pots: Array<{ amount: bigint }> | undefined): bigint {
    if (!pots || pots.length === 0) {
        return 0n;
    }
    return pots.reduce((acc, pot) => acc + pot.amount, 0n);
}

export function ActionOverlay(): JSX.Element | null {
    const currentScene = useUiStore((s) => s.currentScene);
    const requestScene = useUiStore((s) => s.requestScene);
    const replayMode = useReplayStore((s) => s.mode);
    const reiStatusTag = useReiStore((s) => s.statusTag);
    const reiKeyLine = useReiStore((s) => s.keyLine);
    const prompt = useGameStore((s) => s.actionPrompt);
    const snapshot = useGameStore((s) => s.snapshot);
    const potUpdate = useGameStore((s) => s.potUpdate);
    const myChair = useGameStore((s) => s.myChair);
    const myBet = useGameStore((s) => s.myBet);
    const errorMessage = useGameStore((s) => s.errorMessage);
    const dismissActionPrompt = useGameStore((s) => s.dismissActionPrompt);
    const clearError = useGameStore((s) => s.clearError);
    const selectedPlayerChair = useLiveUiStore((s) => s.selectedPlayerChair);
    const closePlayerCard = useLiveUiStore((s) => s.closePlayerCard);
    const [remainingActionMs, setRemainingActionMs] = useState(0);
    const [raiseAmount, setRaiseAmount] = useState(0n);
    const lastSliderSoundAt = useRef(0);

    useEffect(() => {
        if (!errorMessage) {
            return;
        }
        const timer = window.setTimeout(() => {
            clearError();
        }, 2200);
        return () => window.clearTimeout(timer);
    }, [errorMessage, clearError]);

    useEffect(() => {
        if (!prompt) {
            setRemainingActionMs(0);
            return;
        }

        const fallbackLimitMs = Math.max(0, prompt.timeLimitSec) * 1000;
        const localStartMs = Date.now();
        const hasServerDeadline = prompt.actionDeadlineMs > 0n;

        const update = (): void => {
            if (hasServerDeadline) {
                const deadlineMs = Number(prompt.actionDeadlineMs);
                const remaining = deadlineMs - gameClient.getEstimatedServerNowMs();
                setRemainingActionMs(Math.max(0, remaining));
                return;
            }
            const elapsed = Date.now() - localStartMs;
            setRemainingActionMs(Math.max(0, fallbackLimitMs - elapsed));
        };

        update();
        const timer = window.setInterval(update, 100);
        return () => window.clearInterval(timer);
    }, [prompt]);

    useEffect(() => {
        if (prompt?.minRaiseTo) {
            setRaiseAmount(prompt.minRaiseTo);
        } else if (prompt?.callAmount) {
            setRaiseAmount(prompt.callAmount + (myBet || 0n));
        }
    }, [prompt, myBet]);

    const myStack = useMemo(() => {
        const player = snapshot?.players.find((p) => p.chair === myChair);
        return player?.stack ?? 0n;
    }, [snapshot, myChair]);

    const selectedPlayer = useMemo(() => {
        if (!snapshot || selectedPlayerChair < 0) {
            return null;
        }
        return snapshot.players.find((p) => p.chair === selectedPlayerChair) ?? null;
    }, [snapshot, selectedPlayerChair]);

    const potTotal = useMemo(() => {
        const collectedPots = potUpdate ? sumPots(potUpdate.pots) : sumPots(snapshot?.pots);
        const liveBets = snapshot?.players?.reduce((acc, p) => acc + (p.bet || 0n), 0n) ?? 0n;
        return collectedPots + liveBets;
    }, [snapshot, potUpdate]);

    const legalActions = useMemo(() => {
        return new Set(prompt?.legalActions ?? []);
    }, [prompt]);

    const hasCheck = legalActions.has(ActionType.ACTION_CHECK);
    const hasCall = legalActions.has(ActionType.ACTION_CALL);
    const hasFold = legalActions.has(ActionType.ACTION_FOLD);
    const hasBet = legalActions.has(ActionType.ACTION_BET);
    const hasRaiseOnly = legalActions.has(ActionType.ACTION_RAISE);
    const hasRaise = hasBet || hasRaiseOnly || legalActions.has(ActionType.ACTION_ALLIN);
    const canAllIn = legalActions.has(ActionType.ACTION_ALLIN);

    const isMyTurn = !!prompt && prompt.chair === myChair;
    const isActionExpired = isMyTurn && remainingActionMs <= 0;
    const canFold = isMyTurn && !isActionExpired && hasFold;
    const canPrimary = isMyTurn && !isActionExpired && (hasCheck || hasCall);
    const canRaiseTile = isMyTurn && !isActionExpired && (hasRaise || canAllIn);
    const canQuickRaise = isMyTurn && !isActionExpired && hasRaise;
    const canQuickAllIn = isMyTurn && !isActionExpired && canAllIn;

    const playUiClick = (): void => {
        audioManager.play(SoundMap.UI_CLICK, 0.7);
    };

    const playUiSlider = (): void => {
        const now = Date.now();
        if (now - lastSliderSoundAt.current < 75) {
            return;
        }
        lastSliderSoundAt.current = now;
        audioManager.play(SoundMap.UI_SLIDER, 0.45);
    };

    const playActionSound = (action: ActionType): void => {
        switch (action) {
            case ActionType.ACTION_FOLD:
                audioManager.play(SoundMap.ACTION_FOLD);
                break;
            case ActionType.ACTION_CHECK:
                audioManager.play(SoundMap.ACTION_CHECK);
                break;
            case ActionType.ACTION_CALL:
                audioManager.play(SoundMap.ACTION_CALL);
                break;
            case ActionType.ACTION_RAISE:
                audioManager.play(SoundMap.ACTION_RAISE);
                break;
            case ActionType.ACTION_ALLIN:
                audioManager.play(SoundMap.ACTION_ALLIN);
                break;
            case ActionType.ACTION_BET:
                audioManager.play(SoundMap.CHIP_BET);
                break;
            default:
                break;
        }
    };

    useEffect(() => {
        if (!prompt || prompt.chair !== myChair) {
            return;
        }
        audioManager.play(SoundMap.TURN_ALERT);
    }, [prompt?.chair, prompt?.actionDeadlineMs, myChair]);

    useEffect(() => {
        if (currentScene !== 'table' || replayMode === 'loaded') {
            closePlayerCard();
        }
    }, [currentScene, replayMode, closePlayerCard]);

    useEffect(() => {
        if (selectedPlayerChair < 0 || !snapshot) {
            return;
        }
        const exists = snapshot.players.some((p) => p.chair === selectedPlayerChair);
        if (!exists) {
            closePlayerCard();
        }
    }, [selectedPlayerChair, snapshot, closePlayerCard]);

    if (replayMode === 'loaded') {
        return null;
    }

    if (currentScene !== 'table') {
        return errorMessage ? <div className="action-toast">{errorMessage}</div> : null;
    }

    const callToMatch = prompt?.callAmount ?? 0n;
    const primaryLabel = hasCall && !hasCheck
        ? `CALL $${callToMatch.toLocaleString()}`
        : 'CHECK';
    const tertiaryLabel = hasRaiseOnly ? 'RAISE' : (hasBet ? 'BET' : (canAllIn ? 'ALL IN' : 'RAISE'));
    const minRaiseTo = prompt?.minRaiseTo ?? 0n;
    const halfPotRaiseTo = prompt
        ? (() => {
            const halfPot = potTotal / 2n;
            const target = prompt.callAmount + (myBet || 0n) + halfPot;
            return target > prompt.minRaiseTo ? target : prompt.minRaiseTo;
        })()
        : 0n;

    const submitSmartRaise = (amount: bigint) => {
        if (!prompt) return;
        if (hasRaiseOnly) {
            playActionSound(ActionType.ACTION_RAISE);
            gameClient.raise(amount);
        } else if (hasBet) {
            playActionSound(ActionType.ACTION_BET);
            gameClient.bet(amount);
        } else if (canAllIn) {
            playActionSound(ActionType.ACTION_ALLIN);
            gameClient.allIn(myStack + (myBet || 0n));
        }
        dismissActionPrompt();
    };

    const submitFold = (): void => {
        if (!canFold) {
            return;
        }
        playActionSound(ActionType.ACTION_FOLD);
        gameClient.fold();
        dismissActionPrompt();
    };

    const submitPrimary = (): void => {
        if (!prompt || !canPrimary) {
            return;
        }
        if (hasCall && !hasCheck) {
            playActionSound(ActionType.ACTION_CALL);
            const totalCallAmount = (prompt.callAmount || 0n) + (myBet || 0n);
            gameClient.call(totalCallAmount);
        } else {
            playActionSound(ActionType.ACTION_CHECK);
            gameClient.check();
        }
        dismissActionPrompt();
    };

    const submitRaiseTile = (): void => {
        if (!prompt || !canRaiseTile) return;
        submitSmartRaise(raiseAmount);
    };

    const submitAllIn = (): void => {
        if (!canQuickAllIn) return;
        playActionSound(ActionType.ACTION_ALLIN);
        gameClient.allIn(myStack + (myBet || 0n));
        dismissActionPrompt();
    };

    const submitHalfPot = (): void => {
        if (!canQuickRaise || !prompt) return;
        submitSmartRaise(halfPotRaiseTo);
    };

    const submitMinQuick = (): void => {
        if (!canQuickRaise || !prompt) return;
        submitSmartRaise(prompt.minRaiseTo);
    };

    const leaveSeat = (): void => {
        playUiClick();
        if (myChair !== -1) {
            gameClient.standUp();
        }
        closePlayerCard();
    };

    const returnLobby = (): void => {
        playUiClick();
        if (myChair !== -1) {
            gameClient.standUp();
        }
        requestScene('lobby');
        closePlayerCard();
    };

    const selectedPlayerName = selectedPlayer
        ? (selectedPlayer.nickname.trim() || `PLAYER_${selectedPlayer.userId.toString()}`)
        : '';
    const selectedIsSelf = !!selectedPlayer && selectedPlayer.chair === myChair;

    return (
        <div className="action-overlay">
            {errorMessage && <div className="action-toast">{errorMessage}</div>}

            <div className="top-right-return">
                <button type="button" className="lobby-return-btn" onClick={returnLobby}>
                    <span className="material-symbols-outlined">arrow_back</span>
                    <span>RETURN LOBBY</span>
                </button>
            </div>

            <div className="action-overlay-shell">
                {/* STABLE HEADER: These columns are NEVER destroyed or re-styled */}
                <div className="shell-top-row">
                    <div className="action-stats-summary">
                        <div className="stat-pill stats-stack">
                            <span className="label">YOUR_STACK</span>
                            <span className="value">$<NumberTicker value={myStack} /></span>
                        </div>
                        <div className="stat-pill stats-pot">
                            <span className="label">ACTIVE_POT</span>
                            <span className="value">$<NumberTicker value={potTotal} /></span>
                        </div>
                    </div>
                </div>

                <div className="shell-main-content">
                    {/* PERSISTENT MOUNTING: Use CSS classes for transitions instead of unmounting */}
                    <div className={`player-view-port ${isMyTurn ? 'view-active' : 'view-inactive'}`}>
                        <div className={`player-controls ${(canQuickRaise || canQuickAllIn) ? 'has-betting' : ''}`}>
                            <div className="action-main-group">
                                <div className="action-buttons-grid">
                                    <button className="btn-tile btn-fold" disabled={!canFold} onClick={submitFold}>
                                        <span className="btn-icon">⊘</span>
                                        <span className="btn-label">FOLD</span>
                                    </button>
                                    <button className="btn-tile btn-primary" disabled={!canPrimary} onClick={submitPrimary}>
                                        <span className="btn-icon">{hasCall && !hasCheck ? '◯' : '✓✓'}</span>
                                        <span className="btn-label">{primaryLabel}</span>
                                    </button>
                                    <button className="btn-tile btn-raise-main" disabled={!canRaiseTile} onClick={submitRaiseTile}>
                                        <span className="btn-icon">↗</span>
                                        <span className="btn-label">{tertiaryLabel}</span>
                                    </button>
                                </div>
                            </div>

                            {(canQuickRaise || canQuickAllIn) && (
                                <div className="action-raise-group">
                                    <div className="bet-info-display">
                                        <span className="label">RAISE_TO</span>
                                        <span className="value">${raiseAmount.toLocaleString()}</span>
                                    </div>

                                    <div className="slider-control-dock">
                                        <div className="slider-track-wrap">
                                            <input
                                                type="range"
                                                className="vertical-slider"
                                                min={Number(minRaiseTo)}
                                                max={Number(myStack + (myBet || 0n))}
                                                value={Number(raiseAmount)}
                                                onChange={(e) => {
                                                    setRaiseAmount(BigInt(e.target.value));
                                                    playUiSlider();
                                                }}
                                            />
                                            <div className="slider-visual-ticks">
                                                <div className="tick-line" style={{ bottom: '0%' }} />
                                                <div className="tick-line" style={{ bottom: '100%' }} />
                                            </div>
                                        </div>

                                        <div className="preset-quick-actions">
                                            <button className="preset-btn" onClick={() => { playUiClick(); setRaiseAmount(myStack + (myBet || 0n)); }}>ALL</button>
                                            <button className="preset-btn" onClick={() => { playUiClick(); setRaiseAmount(halfPotRaiseTo); }}>1/2</button>
                                            <button className="preset-btn" onClick={() => { playUiClick(); setRaiseAmount(minRaiseTo); }}>MIN</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={`npc-view-port ${!isMyTurn ? 'view-active' : 'view-inactive'}`}>
                        <div className="npc-chat-content">
                            <div className="npc-chat-layout">
                                <div className="npc-avatar-wrap">
                                    <div className="npc-avatar-box">
                                        <div className="npc-avatar-scanline" />
                                        <div className="npc-avatar-noise" />
                                        <span className="material-symbols-outlined npc-placeholder">person</span>
                                    </div>
                                    <div className="npc-name-tag">REI</div>
                                </div>
                                <div className="npc-content">
                                    <div className="npc-text-header">
                                        <div className="npc-status-left">
                                            <span className="npc-status-dot amp-pulse" />
                                            <span className="npc-status-text">{reiStatusTag}</span>
                                        </div>
                                    </div>
                                    <div className="npc-text-body">{reiKeyLine}</div>
                                    <div className="npc-cursor" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {selectedPlayer && (
                <div className="live-player-card-backdrop" onPointerDown={closePlayerCard}>
                    <div className="live-player-card" onPointerDown={(event) => event.stopPropagation()}>
                        <div className="live-player-card-header">
                            <span className="live-player-card-tag">{selectedIsSelf ? 'YOU' : 'PLAYER'}</span>
                            <button type="button" className="live-player-card-close" onClick={closePlayerCard}>
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="live-player-card-name">{selectedPlayerName}</div>
                        <div className="live-player-card-meta">Seat {selectedPlayer.chair + 1}</div>
                        <div className="live-player-card-stack">
                            STACK ${selectedPlayer.stack.toLocaleString()}
                        </div>
                        {selectedIsSelf && (
                            <button type="button" className="live-player-leave-btn" onClick={leaveSeat}>
                                LEAVE TABLE
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
