import { Application, Container } from 'pixi.js';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { requireCanvas, requireUiRoot } from './architecture/boundary';
import { audioManager } from './audio/AudioManager';
import { bindReiRuntimeToStores } from './rei/runtime';
import { bootstrapAuthSession } from './store/authStore';
import { bindGameClientToStore } from './store/gameStore';
import type { UiProfile } from './store/layoutStore';
import { useLayoutStore } from './store/layoutStore';
import { useUiStore, type SceneName } from './store/uiStore';
import { UiLayerApp } from './ui/UiLayerApp';

// Design baseline: iPhone 14 Pro Max portrait viewport (430 x 932).
// Keep logical width at 750 for existing scene coordinates, and match baseline aspect ratio.
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = DESIGN_WIDTH * (932 / 430);
// Design-space top offset of the square crop window on desktop.
// Larger values reveal more lower-table content.
const DESKTOP_VIEWPORT_START_Y = 320;
const DESKTOP_CENTER_SQUARE_SCALE = 0.8;

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
            const rails = this.getDesktopRails(w);
            const reservedW = rails.left + rails.right;
            const availableW = Math.max(320, w - reservedW);
            viewportLeft += rails.left;
            layoutW = availableW;

            const squareSide = Math.max(280, Math.min(layoutW, h) * DESKTOP_CENTER_SQUARE_SCALE);
            const scale = squareSide / DESIGN_WIDTH;
            const squareX = viewportLeft + (layoutW - squareSide) / 2;
            const squareY = viewportTop + (h - squareSide) / 2;

            this.app.stage.scale.set(scale);
            this.app.stage.x = squareX;
            this.app.stage.y = squareY - DESKTOP_VIEWPORT_START_Y * scale;

            const rootStyle = document.documentElement.style;
            rootStyle.setProperty('--stage-x', `${squareX}px`);
            rootStyle.setProperty('--stage-y', `${squareY}px`);
            rootStyle.setProperty('--stage-width', `${squareSide}px`);
            rootStyle.setProperty('--stage-height', `${squareSide}px`);
            rootStyle.setProperty('--stage-scale', `${scale}`);
            return;
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
