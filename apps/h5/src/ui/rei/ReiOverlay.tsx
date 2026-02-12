import { useCallback, useEffect, useRef, useState } from 'react';
import { useReplayStore } from '../../replay/replayStore';
import { useReiStore } from '../../rei/reiStore';
import { useUiStore } from '../../store/uiStore';
import './rei-overlay.css';

export function ReiOverlay(): JSX.Element | null {
    const currentScene = useUiStore((s) => s.currentScene);
    const replayMode = useReplayStore((s) => s.mode);
    const statusTag = useReiStore((s) => s.statusTag);
    const keyLine = useReiStore((s) => s.keyLine);
    const details = useReiStore((s) => s.details);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [hasOverflow, setHasOverflow] = useState(false);
    const [canScrollUp, setCanScrollUp] = useState(false);
    const [canScrollDown, setCanScrollDown] = useState(false);

    const syncScrollHints = useCallback((): void => {
        const el = scrollRef.current;
        if (!el) {
            setHasOverflow(false);
            setCanScrollUp(false);
            setCanScrollDown(false);
            return;
        }
        const overflow = el.scrollHeight > el.clientHeight + 1;
        setHasOverflow(overflow);
        setCanScrollUp(overflow && el.scrollTop > 1);
        setCanScrollDown(overflow && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    }, []);

    useEffect(() => {
        if (currentScene !== 'table' || replayMode !== 'loaded') {
            return;
        }
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        el.scrollTop = 0;
        syncScrollHints();
    }, [currentScene, replayMode, keyLine, details, syncScrollHints]);

    useEffect(() => {
        if (currentScene !== 'table' || replayMode !== 'loaded') {
            return;
        }
        const el = scrollRef.current;
        if (!el) {
            return;
        }

        const handleScroll = (): void => {
            syncScrollHints();
        };
        el.addEventListener('scroll', handleScroll, { passive: true });

        let ro: ResizeObserver | null = null;
        if ('ResizeObserver' in window) {
            ro = new ResizeObserver(() => {
                syncScrollHints();
            });
            ro.observe(el);
        }
        window.addEventListener('resize', syncScrollHints);

        return () => {
            el.removeEventListener('scroll', handleScroll);
            ro?.disconnect();
            window.removeEventListener('resize', syncScrollHints);
        };
    }, [currentScene, replayMode, syncScrollHints]);

    if (currentScene !== 'table') {
        return null;
    }

    // Live mode currently renders REI in ActionOverlay's NPC viewport.
    if (replayMode !== 'loaded') {
        return null;
    }

    return (
        <div className="action-overlay rei-replay-overlay">
            <div className="action-overlay-shell rei-replay-shell">
                <div className="shell-main-content rei-replay-main">
                    <div className="npc-view-port view-active">
                        <div className="npc-chat-content">
                            <div className="npc-chat-layout">
                                <div className="npc-avatar-wrap">
                                    <div className="npc-avatar-box">
                                        <div className="npc-avatar-scanline" />
                                        <div className="npc-avatar-noise" />
                                        <span className="material-symbols-outlined npc-placeholder">person</span>
                                    </div>
                                    <div className="npc-name-tag">REI // REPLAY</div>
                                </div>
                                <div className="npc-content">
                                    <div className="npc-text-header">
                                        <div className="npc-status-left">
                                            <span className="npc-status-dot amp-pulse" />
                                            <span className="npc-status-text">{statusTag}</span>
                                        </div>
                                    </div>
                                    <div className="rei-replay-scroll-wrap">
                                        <div ref={scrollRef} className="rei-replay-scroll">
                                            <div className="npc-text-body">{keyLine}</div>
                                            <div className="rei-replay-detail">{details}</div>
                                        </div>
                                        {hasOverflow && canScrollUp ? <span className="rei-scroll-triangle rei-scroll-up" /> : null}
                                        {hasOverflow && canScrollDown ? (
                                            <span className="rei-scroll-triangle rei-scroll-down" />
                                        ) : null}
                                    </div>
                                    <div className="npc-cursor" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
