import { useEffect, useMemo } from 'react';
import { ActionType } from '@gen/messages_pb';
import { gameClient } from '../../network/GameClient';
import { useGameStore } from '../../store/gameStore';
import './action-overlay.css';

export function ActionOverlay(): JSX.Element | null {
    const prompt = useGameStore((s) => s.actionPrompt);
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

    const legalActions = useMemo(() => {
        return new Set(prompt?.legalActions ?? []);
    }, [prompt]);

    if (!prompt && !errorMessage) {
        return null;
    }

    const hasCheck = legalActions.has(ActionType.ACTION_CHECK);
    const hasCall = legalActions.has(ActionType.ACTION_CALL);
    const hasFold = legalActions.has(ActionType.ACTION_FOLD);
    const hasRaise =
        legalActions.has(ActionType.ACTION_RAISE) ||
        legalActions.has(ActionType.ACTION_BET) ||
        legalActions.has(ActionType.ACTION_ALLIN);

    const canAllIn = legalActions.has(ActionType.ACTION_ALLIN);
    const primaryLabel = hasCall && !hasCheck ? 'CALL' : 'CHECK';

    const submitFold = (): void => {
        gameClient.fold();
        dismissActionPrompt();
    };

    const submitPrimary = (): void => {
        if (!prompt) {
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

    const submitMinRaise = (): void => {
        if (!prompt) {
            return;
        }
        gameClient.raise(prompt.minRaiseTo);
        dismissActionPrompt();
    };

    const submitAllIn = (): void => {
        gameClient.allIn();
        dismissActionPrompt();
    };

    return (
        <>
            {errorMessage ? <div className="action-toast">{errorMessage}</div> : null}
            {prompt ? (
                <div className="action-overlay">
                    <div className="action-stats">
                        <div className="action-stat">
                            <span className="label">CALL TO MATCH</span>
                            <span className="value">${prompt.callAmount.toString()}</span>
                        </div>
                        <div className="action-stat">
                            <span className="label">MIN RAISE TO</span>
                            <span className="value">${prompt.minRaiseTo.toString()}</span>
                        </div>
                    </div>
                    <div className="action-buttons">
                        {hasFold ? (
                            <button className="btn btn-ghost" onClick={submitFold}>
                                FOLD
                            </button>
                        ) : null}
                        {(hasCheck || hasCall) ? (
                            <button className="btn btn-cyan" onClick={submitPrimary}>
                                {primaryLabel}
                            </button>
                        ) : null}
                        {hasRaise ? (
                            <button className="btn btn-primary" onClick={submitMinRaise}>
                                RAISE
                            </button>
                        ) : null}
                        {canAllIn ? (
                            <button className="btn btn-allin" onClick={submitAllIn}>
                                ALL IN
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </>
    );
}
