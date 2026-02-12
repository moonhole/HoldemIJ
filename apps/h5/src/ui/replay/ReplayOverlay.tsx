import { useMemo, useState } from 'react';
import { demoHandSpec } from '../../replay/demoSpec';
import { decodeReplayServerTape } from '../../replay/replayCodec';
import { useReplayStore } from '../../replay/replayStore';
import { replayWasmClient } from '../../replay/replayWasmClient';
import { useUiStore } from '../../store/uiStore';
import './replay-overlay.css';

export function ReplayOverlay(): JSX.Element | null {
    const currentScene = useUiStore((s) => s.currentScene);
    const requestScene = useUiStore((s) => s.requestScene);
    const mode = useReplayStore((s) => s.mode);
    const tape = useReplayStore((s) => s.tape);
    const cursor = useReplayStore((s) => s.cursor);
    const loadTape = useReplayStore((s) => s.loadTape);
    const clearTape = useReplayStore((s) => s.clearTape);
    const stepForward = useReplayStore((s) => s.stepForward);
    const stepBack = useReplayStore((s) => s.stepBack);
    const seek = useReplayStore((s) => s.seek);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const totalEvents = tape?.events.length ?? 0;
    const canBack = mode === 'loaded' && cursor >= 0;
    const canForward = mode === 'loaded' && cursor < totalEvents - 1;

    const sliderValue = useMemo(() => {
        if (cursor < 0) return 0;
        return cursor + 1;
    }, [cursor]);

    const maxSlider = Math.max(1, totalEvents);

    const loadDemo = async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const serverTape = await replayWasmClient.init(demoHandSpec);
            const decoded = decodeReplayServerTape(serverTape);
            loadTape(decoded);
            if (currentScene !== 'table') {
                requestScene('table');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'failed to load replay');
        } finally {
            setLoading(false);
        }
    };

    const onSeekChange = (value: number): void => {
        if (!tape) return;
        seek(value - 1);
    };

    if (currentScene === 'login') {
        return null;
    }

    return (
        <div className="replay-overlay">
            <div className="replay-title">REPLAY CONTROL</div>
            <div className="replay-meta">
                Mode: {mode.toUpperCase()} | Cursor: {cursor} / {Math.max(totalEvents - 1, -1)}
            </div>

            <div className="replay-row">
                <button className="replay-btn" onClick={loadDemo} disabled={loading}>
                    {loading ? 'LOADING...' : 'LOAD DEMO'}
                </button>
                <button className="replay-btn" onClick={clearTape} disabled={mode !== 'loaded'}>
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

            {error ? <div className="replay-error">{error}</div> : null}
        </div>
    );
}
