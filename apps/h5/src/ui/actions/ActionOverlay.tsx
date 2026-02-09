import { useEffect, useMemo } from 'react';
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

    useEffect(() => {
        if (!errorMessage) {
            return;
        }
        const timer = window.setTimeout(() => {
            clearError();
        }, 2200);
        return () => window.clearTimeout(timer);
    }, [errorMessage, clearError]);

    const myStack = useMemo(() => {
        const player = snapshot?.players.find((p) => p.chair === myChair);
        return player?.stack ?? 0n;
    }, [snapshot, myChair]);

    const potTotal = useMemo(() => {
        if (potUpdate) {
            return sumPots(potUpdate.pots);
        }
        if (snapshot) {
            return sumPots(snapshot.pots);
        }
        return 0n;
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
    const canFold = isMyTurn && hasFold;
    const canPrimary = isMyTurn && (hasCheck || hasCall);
    const canRaiseTile = isMyTurn && (hasRaise || canAllIn);
    const canQuickRaise = isMyTurn && hasRaise;
    const canQuickAllIn = isMyTurn && canAllIn;

    if (currentScene !== 'table') {
        return errorMessage ? <div className="action-toast">{errorMessage}</div> : null;
    }

    if (!isMyTurn && !errorMessage) {
        return <NpcChat prompt={prompt} snapshot={snapshot} myChair={myChair} myStack={myStack} />;
    }

    const primaryLabel = hasCall && !hasCheck ? 'CALL' : 'CHECK';
    const tertiaryLabel = hasRaiseOnly ? 'RAISE' : (hasBet ? 'BET' : 'ALL IN');
    const callToMatch = prompt?.callAmount ?? 0n;
    const minRaiseTo = prompt?.minRaiseTo ?? 0n;
    const halfPotRaiseTo = prompt
        ? (() => {
            const halfPot = potTotal / 2n;
            const target = prompt.callAmount + myBet + halfPot;
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
            gameClient.allIn();
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
            const totalCallAmount = prompt.callAmount + myBet;
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
        gameClient.allIn();
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
        <>
            {errorMessage ? <div className="action-toast">{errorMessage}</div> : null}
            <div className="action-overlay">
                <div className="action-overlay-shell">
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
                    <div className="action-stats">
                        <div className="action-stat is-left">
                            <span className="label">YOUR STACK</span>
                            <span className="value">$<NumberTicker value={myStack} /></span>
                        </div>
                        <div className="action-stat is-right">
                            <span className="label">CALL TO MATCH</span>
                            <span className="value value-cyan">$<NumberTicker value={callToMatch} /></span>
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
            </div>
        </>
    );
}

function NpcChat({ prompt, snapshot, myChair, myStack }: { prompt: any; snapshot: any; myChair: number; myStack: bigint }): JSX.Element {
    const activeChair = prompt?.chair ?? -1;
    const activePlayer = snapshot?.players.find((p: any) => p.chair === activeChair);
    const playerName = activePlayer ? `PLAYER_${activePlayer.userId}` : 'SYSTEM';

    return (
        <div className="action-overlay">
            <div className="npc-chat-box">
                <div className="npc-avatar-wrap">
                    <div className="npc-avatar-box">
                        <div className="npc-avatar-scanline" />
                        <div className="npc-avatar-noise" />
                        <span className="material-symbols-outlined npc-placeholder">person</span>
                    </div>
                    <div className="npc-name-tag">{playerName}</div>
                </div>
                <div className="npc-content">
                    <div className="npc-text-header">
                        <div className="npc-status-left">
                            <span className="npc-status-dot" />
                            <span className="npc-status-text">THINKING_PROMPT_WAIT</span>
                        </div>
                        <div className="npc-stack-mini">
                            <span className="label">YOUR STACK</span>
                            <span className="value">$<NumberTicker value={myStack} /></span>
                        </div>
                    </div>
                    <div className="npc-text-body">
                        分析数据流中... 当前胜率计算结果偏向保守。正在评估对局者的心理博弈权重。系统建议：保持观察。
                    </div>
                    <div className="npc-cursor" />
                </div>
            </div>
        </div>
    );
}
