import { useEffect, useMemo, useState } from 'react';
import { ActionType } from '@gen/messages_pb';
import { gameClient } from '../../network/GameClient';
import { useGameStore } from '../../store/gameStore';
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
    const prompt = useGameStore((s) => s.actionPrompt);
    const snapshot = useGameStore((s) => s.snapshot);
    const potUpdate = useGameStore((s) => s.potUpdate);
    const myChair = useGameStore((s) => s.myChair);
    const myBet = useGameStore((s) => s.myBet);
    const errorMessage = useGameStore((s) => s.errorMessage);
    const dismissActionPrompt = useGameStore((s) => s.dismissActionPrompt);
    const clearError = useGameStore((s) => s.clearError);
    const [remainingActionMs, setRemainingActionMs] = useState(0);

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

    const myStack = useMemo(() => {
        const player = snapshot?.players.find((p) => p.chair === myChair);
        return player?.stack ?? 0n;
    }, [snapshot, myChair]);

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

    if (currentScene !== 'table') {
        return errorMessage ? <div className="action-toast">{errorMessage}</div> : null;
    }

    const primaryLabel = hasCall && !hasCheck ? 'CALL' : 'CHECK';
    const tertiaryLabel = hasRaiseOnly ? 'RAISE' : (hasBet ? 'BET' : (canAllIn ? 'ALL IN' : 'RAISE'));
    const callToMatch = prompt?.callAmount ?? 0n;
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
            gameClient.raise(amount);
        } else if (hasBet) {
            gameClient.bet(amount);
        } else if (canAllIn) {
            gameClient.allIn(myStack + (myBet || 0n));
        }
        dismissActionPrompt();
    };

    const submitFold = (): void => {
        if (!canFold) {
            return;
        }
        gameClient.fold();
        dismissActionPrompt();
    };

    const submitPrimary = (): void => {
        if (!prompt || !canPrimary) {
            return;
        }
        if (hasCall && !hasCheck) {
            const totalCallAmount = (prompt.callAmount || 0n) + (myBet || 0n);
            gameClient.call(totalCallAmount);
        } else {
            gameClient.check();
        }
        dismissActionPrompt();
    };

    const submitRaiseTile = (): void => {
        if (!prompt || !canRaiseTile) return;
        submitSmartRaise(prompt.minRaiseTo);
    };

    const submitAllIn = (): void => {
        if (!canQuickAllIn) return;
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

    return (
        <div className="action-overlay">
            {errorMessage && <div className="action-toast">{errorMessage}</div>}

            <div className={`action-overlay-shell ${!isMyTurn ? 'is-npc-mode' : ''}`}>
                <div className="shell-top-row">
                    {/* Common Stats Area - Remains mounted for smooth Ticker and layout stability */}
                    <div className="action-stats">
                        <div className="action-stat is-left">
                            <span className="label">YOUR STACK</span>
                            <span className="value">$<NumberTicker value={myStack} /></span>
                        </div>
                        {isMyTurn && callToMatch > 0n && (
                            <div className="action-stat is-center fade-in">
                                <span className="label">TO CALL</span>
                                <span className="value value-cyan">$<NumberTicker value={callToMatch} /></span>
                            </div>
                        )}
                        <div className="action-stat is-right">
                            <span className="label">ACTIVE POT</span>
                            <span className="value value-cyan">$<NumberTicker value={potTotal} /></span>
                        </div>
                    </div>
                </div>

                <div className="shell-main-content">
                    {isMyTurn ? (
                        <div className="player-controls fade-in">
                            <div className="bet-arc-area">
                                <div className="bet-arc-track">
                                    <button className="bet-arc-knob" type="button" disabled={!canQuickRaise}>
                                        ↕
                                    </button>
                                </div>
                                <div className="bet-pill">
                                    <p className="bet-pill-label">BET AMOUNT</p>
                                    <p className="bet-pill-value">$<NumberTicker value={minRaiseTo} /></p>
                                </div>
                            </div>

                            <div className="action-buttons">
                                <button className="btn-tile btn-fold" disabled={!canFold} onClick={submitFold}>
                                    <span className="btn-icon">⊘</span>
                                    <span className="btn-label">FOLD</span>
                                </button>
                                <button className="btn-tile btn-check" disabled={!canPrimary} onClick={submitPrimary}>
                                    <span className="btn-icon">{hasCall && !hasCheck ? '◯' : '✓✓'}</span>
                                    <span className="btn-label">{primaryLabel}</span>
                                </button>
                                <button className="btn-tile btn-raise" disabled={!canRaiseTile} onClick={submitRaiseTile}>
                                    <span className="btn-icon">{hasRaise ? '↗' : '↑↑'}</span>
                                    <span className="btn-label">{tertiaryLabel}</span>
                                </button>
                            </div>

                            <div className="quick-bets">
                                <button className="quick-bet-btn" disabled={!canQuickRaise} onClick={submitMinQuick}>
                                    MIN
                                </button>
                                <button className="quick-bet-btn" disabled={!canQuickRaise} onClick={submitHalfPot}>
                                    1/2 POT
                                </button>
                                <button className="quick-bet-btn" disabled={!canQuickAllIn} onClick={submitAllIn}>
                                    ALL IN
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="npc-chat-content fade-in">
                            <div className="npc-chat-layout">
                                <div className="npc-avatar-wrap">
                                    <div className="npc-avatar-box">
                                        <div className="npc-avatar-scanline" />
                                        <div className="npc-avatar-noise" />
                                        <span className="material-symbols-outlined npc-placeholder">person</span>
                                    </div>
                                    <div className="npc-name-tag">
                                        {prompt?.chair !== undefined ? `PLAYER_${snapshot?.players.find((p: any) => p.chair === prompt.chair)?.userId ?? '?'}` : 'SYSTEM'}
                                    </div>
                                </div>
                                <div className="npc-content">
                                    <div className="npc-text-header">
                                        <div className="npc-status-left">
                                            <span className="npc-status-dot amp-pulse" />
                                            <span className="npc-status-text">THINKING_PROMPT_WAIT</span>
                                        </div>
                                    </div>
                                    <div className="npc-text-body">
                                        正在同步下注数据流... 系统评估分析建议：观察对手频率，当前胜率模型维持稳定预期。
                                    </div>
                                    <div className="npc-cursor" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
