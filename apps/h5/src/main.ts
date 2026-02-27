import { ActionType } from '@gen/messages_pb';
import { Application, Container, Graphics } from 'pixi.js';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { requireCanvas, requireUiRoot } from './architecture/boundary';
import { audioManager } from './audio/AudioManager';
import { gameClient } from './network/GameClient';
import { bindReiRuntimeToStores } from './rei/runtime';
import { bootstrapAuthSession, useAuthStore } from './store/authStore';
import { bindGameClientToStore, useGameStore } from './store/gameStore';
import type { UiProfile } from './store/layoutStore';
import { useLayoutStore } from './store/layoutStore';
import type { PerfBottleneckKind } from './store/perfStore';
import { usePerfStore } from './store/perfStore';
import { bindUiClientToStore, useUiStore, type SceneName } from './store/uiStore';
import { UiLayerApp } from './ui/UiLayerApp';

// Design baseline: iPhone 14 Pro Max portrait viewport (430 x 932).
// Keep logical width at 750 for existing scene coordinates, and match baseline aspect ratio.
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = DESIGN_WIDTH * (932 / 430);
// Target Y offset in the design space that should align with the top of the center column.
// Note: Handled dynamically for centering in desktop mode now.

const PERF_SAMPLE_WINDOW = 180;
const PERF_FLUSH_INTERVAL_MS = 250;
const LONG_FRAME_THRESHOLD_MS = 34;
const PERF_AUTOPILOT_TICK_MS = 220;

type DynamicRenderer = {
    name?: string;
    render?: (...args: unknown[]) => unknown;
    stats?: { drawCalls?: number };
    statistics?: { drawCalls?: number };
    renderPipes?: {
        batch?: {
            _activeBatches?: Record<string, { batches?: unknown[] }>;
            _batchersByInstructionSet?: Record<string, Record<string, { batches?: unknown[] }>>;
        };
    };
};

type PerfExportSample = {
    scenario: string;
    scene: SceneName;
    rendererType: string;
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

type PerfAutopilotMode = 'lobbyIdle' | 'tableIdle' | 'tableActive';

type DesktopBridge = {
    reportPerfSample?: (sample: PerfExportSample) => void;
    network?: {
        scenario?: string;
        apiBaseUrl?: string;
        wsUrl?: string;
    };
};

class GameApp {
    private app: Application;
    private currentScene: Container | null = null;
    private currentSceneName: SceneName = 'login';
    private uiRoot: Root | null = null;
    private unsubscribeUiStore: (() => void) | null = null;
    private viewportEl: HTMLElement | Window = window;
    private pendingDestroy: Container[] = [];
    private forcedUiProfile: UiProfile | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private desktopMask: Graphics | null = null;
    private perfLoopHandle: number | null = null;
    private restoreRendererRender: (() => void) | null = null;
    private perfExportEnabled = false;
    private perfScenario = 'unspecified';
    private perfAutopilotEnabled = false;
    private perfAutopilotHandle: number | null = null;
    private perfAutopilotRunning = false;
    private perfAutopilotUser = 'dev_admin';
    private perfAutopilotPass = 'password';
    private perfAutopilotMode: PerfAutopilotMode = 'tableActive';
    private perfAutopilotLastPromptSig = '';

    constructor() {
        this.app = new Application();
        this.forcedUiProfile = this.readForcedUiProfile();
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    private getDesktopRails(viewportWidth: number): { left: number; right: number } {
        const left = this.clamp(viewportWidth * 0.234, 338, 416);
        const right = this.clamp(viewportWidth * 0.338, 468, 676);
        return { left, right };
    }

    async init(): Promise<void> {
        // Pixi and React mount points are separated by boundary contract.
        const canvas = requireCanvas();
        const uiLayer = requireUiRoot();
        void canvas;
        this.viewportEl = window;
        bindGameClientToStore();
        bindUiClientToStore();
        bindReiRuntimeToStores();

        // Initialize Audio
        audioManager.init().catch(console.warn);

        // Global interaction listener to unlock audio context
        const unlockAudio = () => {
            audioManager.unlock();
            window.removeEventListener('click', unlockAudio);
            window.removeEventListener('keydown', unlockAudio);
            window.removeEventListener('touchstart', unlockAudio);
        };
        window.addEventListener('click', unlockAudio);
        window.addEventListener('keydown', unlockAudio);
        window.addEventListener('touchstart', unlockAudio);

        // Apply uiProfile before rendering overlays to avoid a compact->desktop flash.
        this.syncUiProfile();

        this.uiRoot = createRoot(uiLayer);
        this.uiRoot.render(createElement(UiLayerApp));

        this.unsubscribeUiStore = useUiStore.subscribe((state, prev) => {
            if (!state.requestedScene || state.requestedScene === prev.requestedScene) {
                return;
            }
            const targetScene = state.requestedScene;
            void this.loadScene(targetScene).finally(() => {
                useUiStore.getState().consumeSceneRequest(targetScene);
            });
        });

        await this.app.init({
            canvas,
            background: '#120810',
            resizeTo: this.viewportEl,
            antialias: true,
            // iOS Safari/PWA has better stability with WebGL forced.
            preference: 'webgl',
            resolution: Math.min(window.devicePixelRatio, 2),
            autoDensity: true,
        });

        this.setupPerfOverlayMonitor();

        // Setup resize handling
        this.handleResize();
        window.addEventListener('resize', () => this.handleResize());
        if (this.viewportEl instanceof HTMLElement && 'ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(() => this.handleResize());
            this.resizeObserver.observe(this.viewportEl);
        }
        // Avoid zero-size first frame in grid/flex containers.
        window.requestAnimationFrame(() => this.handleResize());

        const authenticated = await bootstrapAuthSession();
        await this.loadScene(authenticated ? 'lobby' : 'login');
        this.setupPerfAutopilot();

        console.log('[GameApp] Initialized');
    }

    private readForcedUiProfile(): UiProfile | null {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('profile');
        if (raw === 'desktop' || raw === 'compact') {
            return raw;
        }
        return null;
    }

    private resolveUiProfile(windowW: number, windowH: number): UiProfile {
        if (this.forcedUiProfile) {
            return this.forcedUiProfile;
        }

        // Prefer desktop layout on landscape viewports, even when height is constrained.
        if (windowW >= 1024 && windowW / Math.max(windowH, 1) >= 1.15) {
            return 'desktop';
        }

        return 'compact';
    }

    private syncUiProfile(): UiProfile {
        const nextProfile = this.resolveUiProfile(window.innerWidth, window.innerHeight);
        const layoutState = useLayoutStore.getState();
        if (layoutState.uiProfile !== nextProfile) {
            layoutState.setUiProfile(nextProfile);
        }

        const root = document.documentElement;
        root.classList.toggle('profile-desktop', nextProfile === 'desktop');
        root.classList.toggle('profile-compact', nextProfile === 'compact');
        return nextProfile;
    }

    private handleResize(): void {
        const profile = this.syncUiProfile();

        const rawW = this.viewportEl instanceof Window ? this.viewportEl.innerWidth : this.viewportEl.clientWidth;
        const rawH = this.viewportEl instanceof Window ? this.viewportEl.innerHeight : this.viewportEl.clientHeight;
        const viewportRect = this.viewportEl instanceof Window ? null : this.viewportEl.getBoundingClientRect();
        const hasViewportSize = rawW > 1 && rawH > 1;
        const w = hasViewportSize ? rawW : window.innerWidth;
        const h = hasViewportSize ? rawH : window.innerHeight;
        let viewportLeft = hasViewportSize ? (viewportRect?.left ?? 0) : 0;
        const viewportTop = hasViewportSize ? (viewportRect?.top ?? 0) : 0;
        let layoutW = w;

        if (profile === 'desktop') {
            // 1. Lock center column to the design aspect ratio.
            const TARGET_RATIO = DESIGN_WIDTH / DESIGN_HEIGHT;
            const centerW = Math.min(w * 0.55, h * TARGET_RATIO);

            // 2. Golden ratio split: (left + center) : right = φ : 1
            const PHI = 1.618033988749895;
            const rightW = w / (1 + PHI);           // ≈ 38.2 % of total
            const leftPlusCenterW = w - rightW;     // ≈ 61.8 % of total
            const leftW = Math.max(leftPlusCenterW - centerW, 220);

            // Rebuild rails object for downstream use
            const rails = { left: leftW, right: w - leftW - centerW };

            viewportLeft += rails.left;
            layoutW = centerW;

            // Center the stage visually in the remaining height.
            const scale = layoutW / DESIGN_WIDTH;
            const stageX = viewportLeft;
            const stageY = viewportTop + (h - DESIGN_HEIGHT * scale) / 2;

            this.app.stage.scale.set(scale);
            this.app.stage.x = stageX;
            this.app.stage.y = stageY;

            // Clip the stage to the center column bounds so content
            // doesn't overflow above/below the window.
            if (!this.desktopMask) {
                this.desktopMask = new Graphics();
                this.app.stage.addChild(this.desktopMask);
            }
            const clipTop = -stageY / scale;
            const clipH = h / scale;
            this.desktopMask.clear();
            this.desktopMask.rect(0, clipTop, DESIGN_WIDTH, clipH);
            this.desktopMask.fill({ color: 0xffffff });
            this.app.stage.mask = this.desktopMask;

            const rootStyle = document.documentElement.style;
            rootStyle.setProperty('--stage-x', `${stageX}px`);
            rootStyle.setProperty('--stage-y', `${viewportTop}px`);
            rootStyle.setProperty('--stage-width', `${layoutW}px`);
            rootStyle.setProperty('--stage-height', `${h}px`);
            rootStyle.setProperty('--stage-scale', `${scale}`);
            // Push rail sizes to CSS variables so React layout Grid matches perfectly
            rootStyle.setProperty('--panel-left-width', `${rails.left}px`);
            rootStyle.setProperty('--panel-right-width', `${rails.right}px`);
            return;
        }

        // Remove desktop mask when switching back to compact profile.
        if (this.desktopMask) {
            this.app.stage.mask = null;
            this.desktopMask.destroy();
            this.desktopMask = null;
        }

        // Use contain scaling to avoid any left/right cropping.
        const scaleX = layoutW / DESIGN_WIDTH;
        const scaleY = h / DESIGN_HEIGHT;
        const scale = Math.min(scaleX, scaleY);

        // Apply scale to stage
        this.app.stage.scale.set(scale);

        // Center the stage
        const stageX = (layoutW - DESIGN_WIDTH * scale) / 2;
        const stageY = (h - DESIGN_HEIGHT * scale) / 2;
        this.app.stage.x = stageX;
        this.app.stage.y = stageY;

        // Expose stage bounds to DOM overlay for pixel alignment.
        const stageW = DESIGN_WIDTH * scale;
        const stageH = DESIGN_HEIGHT * scale;
        const stageScreenX = viewportLeft + stageX;
        const stageScreenY = viewportTop + stageY;
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--stage-x', `${stageScreenX}px`);
        rootStyle.setProperty('--stage-y', `${stageScreenY}px`);
        rootStyle.setProperty('--stage-width', `${stageW}px`);
        rootStyle.setProperty('--stage-height', `${stageH}px`);
        rootStyle.setProperty('--stage-scale', `${scale}`);
    }

    private shouldEnablePerfOverlay(): boolean {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('perf');
        if (raw === '1' || raw === 'true') {
            return true;
        }
        if (raw === '0' || raw === 'false') {
            return false;
        }
        return import.meta.env.DEV;
    }

    private shouldExportPerfSamples(): boolean {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('perfExport');
        return raw === '1' || raw === 'true';
    }

    private readBooleanParam(name: string): boolean {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get(name);
        return raw === '1' || raw === 'true';
    }

    private readStringParam(name: string, fallback: string): string {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get(name);
        if (!raw || raw.trim() === '') {
            return fallback;
        }
        return raw.trim();
    }

    private readPerfScenario(): string {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('scenario');
        if (!raw || raw.trim() === '') {
            return 'unspecified';
        }
        return raw.trim();
    }

    private getDesktopBridge(): DesktopBridge | null {
        const host = globalThis as typeof globalThis & { desktopBridge?: DesktopBridge };
        return host.desktopBridge ?? null;
    }

    private setupPerfAutopilot(): void {
        this.perfAutopilotEnabled = this.readBooleanParam('perfAuto');
        if (!this.perfAutopilotEnabled) {
            return;
        }

        this.perfAutopilotUser = this.readStringParam('perfUser', 'dev_admin');
        this.perfAutopilotPass = this.readStringParam('perfPass', 'password');
        this.perfAutopilotMode = this.readPerfAutopilotMode();

        const tick = (): void => {
            void this.runPerfAutopilotTick();
        };
        tick();
        this.perfAutopilotHandle = window.setInterval(tick, PERF_AUTOPILOT_TICK_MS);
    }

    private async runPerfAutopilotTick(): Promise<void> {
        if (!this.perfAutopilotEnabled || this.perfAutopilotRunning) {
            return;
        }
        this.perfAutopilotRunning = true;
        try {
            const auth = useAuthStore.getState();
            if (auth.phase === 'unauthenticated') {
                const loggedIn = await auth.login(this.perfAutopilotUser, this.perfAutopilotPass);
                if (!loggedIn) {
                    await auth.register(this.perfAutopilotUser, this.perfAutopilotPass);
                }
                return;
            }
            if (auth.phase !== 'authenticated') {
                return;
            }

            const ui = useUiStore.getState();
            if (ui.currentScene === 'login') {
                ui.requestScene('lobby');
                return;
            }
            if (this.perfAutopilotMode === 'lobbyIdle') {
                if (ui.currentScene === 'table') {
                    ui.requestScene('lobby');
                }
                return;
            }
            if (ui.currentScene === 'lobby') {
                if (ui.quickStartPhase === 'idle' || ui.quickStartPhase === 'error') {
                    await ui.startQuickStart();
                }
                return;
            }
            if (ui.currentScene !== 'table') {
                return;
            }
            if (this.perfAutopilotMode === 'tableIdle') {
                return;
            }

            const game = useGameStore.getState();
            const prompt = game.actionPrompt;
            if (!prompt || prompt.chair !== game.myChair) {
                return;
            }

            const signature = `${game.streamSeq}:${prompt.actionDeadlineMs.toString()}:${prompt.callAmount.toString()}:${prompt.minRaiseTo
                }:${prompt.legalActions.join(',')}`;
            if (signature === this.perfAutopilotLastPromptSig) {
                return;
            }
            this.perfAutopilotLastPromptSig = signature;

            const legalActions = new Set(prompt.legalActions);
            const myBet = game.myBet || 0n;
            const myStack = game.snapshot?.players.find((player) => player.chair === game.myChair)?.stack ?? 0n;

            if (legalActions.has(ActionType.ACTION_CHECK)) {
                gameClient.check();
            } else if (legalActions.has(ActionType.ACTION_CALL)) {
                gameClient.call(prompt.callAmount + myBet);
            } else if (legalActions.has(ActionType.ACTION_FOLD)) {
                gameClient.fold();
            } else if (legalActions.has(ActionType.ACTION_RAISE)) {
                const raiseTo = prompt.minRaiseTo > 0n ? prompt.minRaiseTo : prompt.callAmount + myBet;
                gameClient.raise(raiseTo);
            } else if (legalActions.has(ActionType.ACTION_BET)) {
                const betTo = prompt.minRaiseTo > 0n ? prompt.minRaiseTo : prompt.callAmount + myBet;
                gameClient.bet(betTo);
            } else if (legalActions.has(ActionType.ACTION_ALLIN)) {
                gameClient.allIn(myStack + myBet);
            }

            useGameStore.getState().dismissActionPrompt();
        } catch (error) {
            console.warn('[PerfAuto] tick failed', error);
        } finally {
            this.perfAutopilotRunning = false;
        }
    }

    private readPerfAutopilotMode(): PerfAutopilotMode {
        const raw = this.readStringParam('perfAutoMode', 'tableActive');
        if (raw === 'lobbyIdle' || raw === 'tableIdle' || raw === 'tableActive') {
            return raw;
        }
        return 'tableActive';
    }

    private exportPerfSample(sample: PerfExportSample): void {
        if (!this.perfExportEnabled) {
            return;
        }
        this.getDesktopBridge()?.reportPerfSample?.(sample);
    }

    private setupPerfOverlayMonitor(): void {
        const overlayEnabled = this.shouldEnablePerfOverlay();
        this.perfExportEnabled = this.shouldExportPerfSamples();
        this.perfScenario = this.readPerfScenario();
        const enabled = overlayEnabled || this.perfExportEnabled;
        const perfStore = usePerfStore.getState();
        perfStore.setEnabled(overlayEnabled);
        if (!enabled) {
            return;
        }

        const renderer = this.app.renderer as unknown as DynamicRenderer;
        const rendererName = renderer.name ?? 'unknown';
        perfStore.setRendererType(rendererName);

        const frameSamples: number[] = [];
        const renderSamples: number[] = [];
        let lastFrameTs = performance.now();
        let lastFlushTs = lastFrameTs;
        let longFrames = 0;

        if (typeof renderer.render === 'function') {
            const originalRender = renderer.render.bind(renderer);
            renderer.render = (...args: unknown[]): unknown => {
                const start = performance.now();
                try {
                    return originalRender(...args);
                } finally {
                    const renderMs = performance.now() - start;
                    renderSamples.push(renderMs);
                    if (renderSamples.length > PERF_SAMPLE_WINDOW) {
                        renderSamples.shift();
                    }
                }
            };
            this.restoreRendererRender = () => {
                renderer.render = originalRender;
            };
        }

        const loop = (ts: number): void => {
            const frameMs = ts - lastFrameTs;
            lastFrameTs = ts;

            frameSamples.push(frameMs);
            if (frameSamples.length > PERF_SAMPLE_WINDOW) {
                frameSamples.shift();
            }

            if (frameMs > LONG_FRAME_THRESHOLD_MS) {
                longFrames += 1;
            }

            if (ts - lastFlushTs >= PERF_FLUSH_INTERVAL_MS) {
                const frameAvg = this.average(frameSamples);
                const frameP95 = this.percentile(frameSamples, 0.95);
                const frameMax = frameSamples.length > 0 ? Math.max(...frameSamples) : 0;
                const fps = frameAvg > 0 ? 1000 / frameAvg : 0;
                const renderAvg = this.average(renderSamples);
                const drawCalls = this.readDrawCalls(renderer);
                const diagnosis = this.classifyBottleneck(frameAvg, frameP95, renderAvg, drawCalls);

                usePerfStore.getState().updateMetrics({
                    fps,
                    frameMsAvg: frameAvg,
                    frameMsP95: frameP95,
                    frameMsMax: frameMax,
                    renderMsAvg: renderAvg,
                    drawCalls,
                    longFrames,
                    bottleneckKind: diagnosis.kind,
                    bottleneckLabel: diagnosis.label,
                });
                this.exportPerfSample({
                    scenario: this.perfScenario,
                    scene: this.currentSceneName,
                    rendererType: rendererName,
                    fps,
                    frameMsAvg: frameAvg,
                    frameMsP95: frameP95,
                    frameMsMax: frameMax,
                    renderMsAvg: renderAvg,
                    drawCalls,
                    longFrames,
                    bottleneckKind: diagnosis.kind,
                    bottleneckLabel: diagnosis.label,
                });

                longFrames = 0;
                lastFlushTs = ts;
            }

            this.perfLoopHandle = window.requestAnimationFrame(loop);
        };

        this.perfLoopHandle = window.requestAnimationFrame(loop);
    }

    private readDrawCalls(renderer: DynamicRenderer): number {
        const stats = renderer.statistics?.drawCalls;
        if (typeof stats === 'number' && Number.isFinite(stats)) {
            return stats;
        }
        const legacyStats = renderer.stats?.drawCalls;
        if (typeof legacyStats === 'number' && Number.isFinite(legacyStats)) {
            return legacyStats;
        }

        const batchPipe = renderer.renderPipes?.batch;
        if (!batchPipe) {
            return -1;
        }

        let batches = 0;

        const activeBatches = batchPipe._activeBatches;
        if (activeBatches) {
            for (const batcher of Object.values(activeBatches)) {
                const count = Array.isArray(batcher?.batches) ? batcher.batches.length : 0;
                batches += count;
            }
        }

        if (batches > 0) {
            return batches;
        }

        const byInstructionSet = batchPipe._batchersByInstructionSet;
        if (!byInstructionSet) {
            return -1;
        }

        for (const batchers of Object.values(byInstructionSet)) {
            for (const batcher of Object.values(batchers)) {
                const count = Array.isArray(batcher?.batches) ? batcher.batches.length : 0;
                batches += count;
            }
        }

        return batches > 0 ? batches : -1;
    }

    private average(values: number[]): number {
        if (values.length === 0) {
            return 0;
        }
        const total = values.reduce((acc, value) => acc + value, 0);
        return total / values.length;
    }

    private percentile(values: number[], p: number): number {
        if (values.length === 0) {
            return 0;
        }
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
        return sorted[idx];
    }

    private classifyBottleneck(
        frameMsAvg: number,
        frameMsP95: number,
        renderMsAvg: number,
        drawCalls: number
    ): { kind: PerfBottleneckKind; label: string } {
        if (frameMsAvg <= 18 && frameMsP95 <= 26) {
            return { kind: 'healthy', label: 'Healthy frame pacing.' };
        }

        const hasGcLikeSpikes = frameMsP95 - frameMsAvg >= 12 && renderMsAvg < frameMsAvg * 0.45;
        if (hasGcLikeSpikes) {
            return { kind: 'gc', label: 'Likely main-thread GC/jank spikes.' };
        }

        const renderHeavy = renderMsAvg >= frameMsAvg * 0.7;
        const drawCallHeavy = drawCalls >= 900 && renderMsAvg > 7;
        if (renderHeavy || drawCallHeavy) {
            return { kind: 'gpu', label: 'Likely render/GPU bottleneck.' };
        }

        return { kind: 'cpu', label: 'Likely CPU main-thread bottleneck.' };
    }

    async loadScene(sceneName: string): Promise<void> {
        // Clear current scene
        if (this.currentScene) {
            const disposableScene = this.currentScene as Container & { dispose?: () => void };
            disposableScene.dispose?.();
            this.app.stage.removeChild(this.currentScene);
            // Defer actual destroy to next frame to avoid renderer traversal races.
            this.pendingDestroy.push(this.currentScene);
            this.flushPendingDestroySoon();
        }

        // Load new scene
        switch (sceneName) {
            case 'boot':
                const { BootScene } = await import('./scenes/BootScene');
                this.currentScene = new BootScene(this);
                break;
            case 'login':
                const { LoginScene } = await import('./scenes/LoginScene');
                this.currentScene = new LoginScene(this);
                break;
            case 'lobby':
                const { LobbyScene } = await import('./scenes/LobbyScene');
                this.currentScene = new LobbyScene(this);
                break;
            case 'table':
                const { TableScene } = await import('./scenes/TableScene');
                this.currentScene = new TableScene(this);
                break;
            default:
                console.warn(`Unknown scene: ${sceneName}`);
                return;
        }

        this.app.stage.addChild(this.currentScene);
        this.currentSceneName = sceneName as SceneName;
        useUiStore.getState().setCurrentScene(this.currentSceneName);
    }

    get stage(): Container {
        return this.app.stage;
    }

    private flushPendingDestroySoon(): void {
        window.requestAnimationFrame(() => {
            if (this.pendingDestroy.length === 0) {
                return;
            }
            const scenes = this.pendingDestroy.splice(0, this.pendingDestroy.length);
            for (const scene of scenes) {
                scene.destroy({ children: true });
            }
        });
    }
}

// Bootstrap
const game = new GameApp();
game.init().catch(console.error);

export { DESIGN_HEIGHT, DESIGN_WIDTH, GameApp };
