import { create } from 'zustand';

export type PerfBottleneckKind = 'collecting' | 'healthy' | 'cpu' | 'gc' | 'gpu';

type PerfMetrics = {
    fps: number;
    frameMsAvg: number;
    frameMsP95: number;
    frameMsMax: number;
    renderMsAvg: number;
    drawCalls: number;
    longFrames: number;
    bottleneckKind: PerfBottleneckKind;
    bottleneckLabel: string;
};

type PerfStoreState = PerfMetrics & {
    enabled: boolean;
    rendererType: string;
    setEnabled: (enabled: boolean) => void;
    setRendererType: (rendererType: string) => void;
    updateMetrics: (metrics: PerfMetrics) => void;
};

const DEFAULT_METRICS: PerfMetrics = {
    fps: 0,
    frameMsAvg: 0,
    frameMsP95: 0,
    frameMsMax: 0,
    renderMsAvg: 0,
    drawCalls: -1,
    longFrames: 0,
    bottleneckKind: 'collecting',
    bottleneckLabel: 'Collecting samples...',
};

export const usePerfStore = create<PerfStoreState>((set) => ({
    enabled: false,
    rendererType: 'unknown',
    ...DEFAULT_METRICS,

    setEnabled: (enabled) => set((state) => ({ ...state, enabled })),
    setRendererType: (rendererType) => set((state) => ({ ...state, rendererType })),
    updateMetrics: (metrics) => set((state) => ({ ...state, ...metrics })),
}));

