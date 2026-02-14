import { usePerfStore } from '../../store/perfStore';
import './perf-overlay.css';

function formatNumber(value: number, digits: number = 1): string {
    if (!Number.isFinite(value)) {
        return '--';
    }
    return value.toFixed(digits);
}

export function PerfOverlay(): JSX.Element | null {
    const enabled = usePerfStore((s) => s.enabled);
    const rendererType = usePerfStore((s) => s.rendererType);
    const fps = usePerfStore((s) => s.fps);
    const frameMsAvg = usePerfStore((s) => s.frameMsAvg);
    const frameMsP95 = usePerfStore((s) => s.frameMsP95);
    const frameMsMax = usePerfStore((s) => s.frameMsMax);
    const renderMsAvg = usePerfStore((s) => s.renderMsAvg);
    const drawCalls = usePerfStore((s) => s.drawCalls);
    const longFrames = usePerfStore((s) => s.longFrames);
    const bottleneckKind = usePerfStore((s) => s.bottleneckKind);
    const bottleneckLabel = usePerfStore((s) => s.bottleneckLabel);

    if (!enabled) {
        return null;
    }

    return (
        <aside className="perf-overlay" aria-label="performance diagnostics overlay">
            <div className="perf-overlay-head">PERF LIVE</div>
            <div className="perf-overlay-line">
                <span>Renderer</span>
                <strong>{rendererType.toUpperCase()}</strong>
            </div>
            <div className="perf-overlay-line">
                <span>FPS</span>
                <strong>{formatNumber(fps, 0)}</strong>
            </div>
            <div className="perf-overlay-line">
                <span>Frame Avg</span>
                <strong>{formatNumber(frameMsAvg)} ms</strong>
            </div>
            <div className="perf-overlay-line">
                <span>Frame P95</span>
                <strong>{formatNumber(frameMsP95)} ms</strong>
            </div>
            <div className="perf-overlay-line">
                <span>Frame Max</span>
                <strong>{formatNumber(frameMsMax)} ms</strong>
            </div>
            <div className="perf-overlay-line">
                <span>Render Avg</span>
                <strong>{formatNumber(renderMsAvg)} ms</strong>
            </div>
            <div className="perf-overlay-line">
                <span>Draw Calls</span>
                <strong>{drawCalls >= 0 ? drawCalls : '--'}</strong>
            </div>
            <div className="perf-overlay-line">
                <span>Long Frames</span>
                <strong>{longFrames}</strong>
            </div>
            <div className={`perf-overlay-hint is-${bottleneckKind}`}>{bottleneckLabel}</div>
        </aside>
    );
}

