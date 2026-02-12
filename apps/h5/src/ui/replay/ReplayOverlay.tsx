import { useMemo } from 'react';
import { useReplayStore } from '../../replay/replayStore';
import { useUiStore } from '../../store/uiStore';
import './replay-overlay.css';

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

    const onSeekChange = (value: number): void => {
        if (!tape) return;
        seek(value - 1);
    };

    if (currentScene !== 'table' || mode !== 'loaded') {
        return null;
    }

    return (
        <div className="replay-overlay">
            <div className="replay-title">REPLAY CONTROL</div>
            <div className="replay-meta">
                Mode: {mode.toUpperCase()} | Visual: {cursor} / {Math.max(totalVisualSteps - 1, -1)} | Raw:{' '}
                {rawCursor} / {Math.max(totalRawEvents - 1, -1)}
            </div>

            <div className="replay-row">
                <button
                    className="replay-btn"
                    onClick={() => {
                        clearTape();
                        requestScene('lobby');
                    }}
                >
                    EXIT
                </button>
                <button className="replay-btn" onClick={clearTape}>
                    CLEAR
                </button>
            </div>

            <div className="replay-row">
                <button className="replay-btn" onClick={stepBack} disabled={!canBack}>
                    BACK
                </button>
                <button className="replay-btn" onClick={stepForward} disabled={!canForward}>
                    STEP
                </button>
            </div>

            <input
                className="replay-range"
                type="range"
                min={0}
                max={maxSlider}
                step={1}
                value={sliderValue}
                disabled={mode !== 'loaded'}
                onChange={(e) => onSeekChange(Number(e.target.value))}
            />
        </div>
    );
}
