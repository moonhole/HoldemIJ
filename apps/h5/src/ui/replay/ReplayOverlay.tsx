import { useCallback, useEffect, useMemo, useState } from 'react';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { auditApi, type AuditHandEvent, type AuditRecentHandItem } from '../../network/auditApi';
import { decodeReplayServerTape, type ReplayServerTape } from '../../replay/replayCodec';
import { useReplayStore } from '../../replay/replayStore';
import { useUiStore } from '../../store/uiStore';
import './replay-overlay.css';

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

function buildReplayTape(item: AuditRecentHandItem, heroChair: number, events: AuditHandEvent[]): ReplayServerTape {
    return {
        tapeVersion: 1,
        tableId: `audit_${item.source}_${item.handId}`,
        heroChair,
        events: events.map((event) => ({
            type: event.eventType,
            seq: event.seq,
            envelopeB64: event.envelopeB64,
        })),
    };
}

export function ReplayOverlay(): JSX.Element | null {
    const currentScene = useUiStore((s) => s.currentScene);
    const requestScene = useUiStore((s) => s.requestScene);
    const mode = useReplayStore((s) => s.mode);
    const tape = useReplayStore((s) => s.tape);
    const cursor = useReplayStore((s) => s.cursor);
    const visualSteps = useReplayStore((s) => s.visualSteps);
    const clearTape = useReplayStore((s) => s.clearTape);
    const stepForward = useReplayStore((s) => s.stepForward);
    const stepBack = useReplayStore((s) => s.stepBack);
    const seek = useReplayStore((s) => s.seek);
    const beginSeek = useReplayStore((s) => s.beginSeek);
    const endSeek = useReplayStore((s) => s.endSeek);
    const isSeeking = useReplayStore((s) => s.isSeeking);
    const loadReplayTape = useReplayStore((s) => s.loadTape);
    const [listOpen, setListOpen] = useState(false);
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError] = useState('');
    const [listItems, setListItems] = useState<AuditRecentHandItem[]>([]);
    const [openingHandId, setOpeningHandId] = useState('');
    const [draftSliderValue, setDraftSliderValue] = useState<number | null>(null);

    const playUiClick = (): void => {
        audioManager.play(SoundMap.UI_CLICK, 0.7);
    };

    useEffect(() => {
        if (!listOpen) {
            return;
        }
        let cancelled = false;

        void (async () => {
            setListLoading(true);
            setListError('');
            try {
                const [liveResult, replayResult] = await Promise.allSettled([
                    auditApi.listRecent('live', 20),
                    auditApi.listRecent('replay', 20),
                ]);

                const merged: AuditRecentHandItem[] = [];
                if (liveResult.status === 'fulfilled') {
                    merged.push(...liveResult.value);
                }
                if (replayResult.status === 'fulfilled') {
                    merged.push(...replayResult.value);
                }
                merged.sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());

                if (!cancelled) {
                    setListItems(merged.slice(0, 40));
                    if (liveResult.status === 'rejected' && replayResult.status === 'rejected') {
                        const reason = liveResult.reason instanceof Error ? liveResult.reason.message : 'Failed to load list';
                        setListError(reason);
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    setListError(error instanceof Error ? error.message : 'Failed to load list');
                    setListItems([]);
                }
            } finally {
                if (!cancelled) {
                    setListLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [listOpen]);

    const totalVisualSteps = visualSteps.length;
    const totalRawEvents = tape?.events.length ?? 0;
    const canBack = mode === 'loaded' && cursor >= 0;
    const canForward = mode === 'loaded' && cursor < totalVisualSteps - 1;

    const sliderValue = useMemo(() => {
        if (cursor < 0) return 0;
        return cursor + 1;
    }, [cursor]);

    const rawCursor = useMemo(() => {
        if (cursor < 0) return -1;
        return visualSteps[cursor] ?? -1;
    }, [cursor, visualSteps]);

    const maxSlider = Math.max(0, totalVisualSteps);
    const renderedSliderValue = draftSliderValue ?? sliderValue;

    const onSeekChange = (value: number): void => {
        if (!tape) return;
        seek(value - 1);
    };

    const commitSeek = useCallback((): void => {
        if (!isSeeking) {
            return;
        }
        if (tape) {
            const target = draftSliderValue ?? sliderValue;
            seek(target - 1);
        }
        endSeek();
        setDraftSliderValue(null);
    }, [draftSliderValue, endSeek, isSeeking, seek, sliderValue, tape]);

    useEffect(() => {
        if (!isSeeking) {
            setDraftSliderValue(null);
        }
    }, [isSeeking]);

    useEffect(() => {
        const handlePointerEnd = (): void => {
            commitSeek();
        };
        window.addEventListener('pointerup', handlePointerEnd);
        window.addEventListener('pointercancel', handlePointerEnd);
        return () => {
            window.removeEventListener('pointerup', handlePointerEnd);
            window.removeEventListener('pointercancel', handlePointerEnd);
        };
    }, [commitSeek]);

    const openReplayFromList = async (item: AuditRecentHandItem): Promise<void> => {
        setOpeningHandId(item.handId);
        setListError('');
        try {
            const events = await auditApi.getHand(item.source, item.handId);
            if (events.length === 0) {
                throw new Error('This hand has no replayable events');
            }
            const serverTape = buildReplayTape(item, toHeroChair(item.summary), events);
            const nextTape = decodeReplayServerTape(serverTape);
            if (nextTape.events.length === 0) {
                throw new Error('No supported replay events found');
            }
            loadReplayTape(nextTape);
            setListOpen(false);
        } catch (error) {
            setListError(error instanceof Error ? error.message : 'Failed to open replay hand');
        } finally {
            setOpeningHandId('');
        }
    };

    if (currentScene !== 'table' || mode !== 'loaded') {
        return null;
    }

    return (
        <div className="replay-overlay">
            <section className="replay-shell">
                <header className="replay-head">
                    <span className="replay-title">REPLAY CONTROL</span>
                    <span className="replay-chip">{mode.toUpperCase()}</span>
                </header>
                <div className="replay-meta">
                    Visual {cursor} / {Math.max(totalVisualSteps - 1, -1)} | Raw {rawCursor} / {Math.max(totalRawEvents - 1, -1)}
                </div>

                <div className="replay-row">
                    <button className="replay-btn replay-btn-secondary" onClick={stepBack} disabled={!canBack}>
                        BACK
                    </button>
                    <button className="replay-btn replay-btn-primary" onClick={stepForward} disabled={!canForward}>
                        STEP
                    </button>
                </div>

                <input
                    className="replay-range"
                    type="range"
                    min={0}
                    max={maxSlider}
                    step={1}
                    value={renderedSliderValue}
                    disabled={mode !== 'loaded'}
                    onPointerDown={() => {
                        beginSeek();
                        setDraftSliderValue(sliderValue);
                    }}
                    onPointerUp={() => commitSeek()}
                    onPointerCancel={() => commitSeek()}
                    onBlur={() => commitSeek()}
                    onChange={(e) => {
                        const next = Number(e.target.value);
                        if (isSeeking) {
                            setDraftSliderValue(next);
                            return;
                        }
                        onSeekChange(next);
                    }}
                />

                <div className="replay-row">
                    <button
                        className="replay-btn replay-btn-secondary"
                        onClick={() => {
                            playUiClick();
                            clearTape();
                            requestScene('lobby');
                        }}
                    >
                        EXIT
                    </button>
                    <button
                        className="replay-btn replay-btn-secondary"
                        onClick={() => {
                            playUiClick();
                            setListOpen(true);
                        }}
                    >
                        LIST
                    </button>
                </div>
            </section>

            {listOpen ? (
                <div className="replay-list-backdrop">
                    <section className="replay-list-modal" aria-label="replay hand list">
                        <header className="replay-list-header">
                            <h3>REPLAY / HAND LIST</h3>
                            <button
                                type="button"
                                className="replay-list-close-btn"
                                onClick={() => {
                                    playUiClick();
                                    setListOpen(false);
                                }}
                            >
                                CLOSE
                            </button>
                        </header>

                        {listLoading ? <div className="replay-list-state">Loading...</div> : null}
                        {!listLoading && listItems.length === 0 ? (
                            <div className="replay-list-state">No hands found.</div>
                        ) : null}
                        {!listLoading && listItems.length > 0 ? (
                            <div className="replay-list-items">
                                {listItems.map((item) => (
                                    <article key={`${item.source}:${item.handId}`} className="replay-list-item">
                                        <div className="replay-list-item-row">
                                            <div>
                                                <div className="replay-list-hand-id">{item.handId}</div>
                                                <div className="replay-list-hand-meta">
                                                    [{item.source.toUpperCase()}] {new Date(item.playedAt).toLocaleString()}
                                                </div>
                                            </div>
                                            <div
                                                className={`replay-list-delta ${
                                                    toSignedDelta(item.summary).startsWith('+') ? 'is-pos' : 'is-neg'
                                                }`}
                                            >
                                                {toSignedDelta(item.summary)}
                                            </div>
                                        </div>
                                        <div className="replay-list-item-row">
                                            <span className="replay-list-hand-meta">Chair: {toHeroChair(item.summary)}</span>
                                            <button
                                                type="button"
                                                className="replay-list-open-btn"
                                                disabled={openingHandId === item.handId}
                                                onClick={() => {
                                                    playUiClick();
                                                    void openReplayFromList(item);
                                                }}
                                            >
                                                {openingHandId === item.handId ? 'OPENING...' : 'OPEN'}
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        ) : null}
                        {listError ? <div className="replay-list-error">{listError}</div> : null}
                    </section>
                </div>
            ) : null}
        </div>
    );
}
