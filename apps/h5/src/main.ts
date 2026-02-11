import { Application, Container } from 'pixi.js';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { requireCanvas, requireUiRoot } from './architecture/boundary';
import { audioManager } from './audio/AudioManager';
import { bootstrapAuthSession } from './store/authStore';
import { bindGameClientToStore } from './store/gameStore';
import { useUiStore, type SceneName } from './store/uiStore';
import { UiLayerApp } from './ui/UiLayerApp';

// Design baseline: iPhone 14 Pro Max portrait viewport (430 x 932).
// Keep logical width at 750 for existing scene coordinates, and match baseline aspect ratio.
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = DESIGN_WIDTH * (932 / 430);

class GameApp {
    private app: Application;
    private currentScene: Container | null = null;
    private currentSceneName: SceneName = 'login';
    private uiRoot: Root | null = null;
    private unsubscribeUiStore: (() => void) | null = null;
    private viewportEl: HTMLElement | Window = window;

    constructor() {
        this.app = new Application();
    }

    async init(): Promise<void> {
        // Pixi and React mount points are separated by boundary contract.
        const canvas = requireCanvas();
        const uiLayer = requireUiRoot();
        this.viewportEl = canvas.parentElement instanceof HTMLElement ? canvas.parentElement : window;
        bindGameClientToStore();

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
            resolution: Math.min(window.devicePixelRatio, 2),
            autoDensity: true,
        });

        // Setup resize handling
        this.handleResize();
        window.addEventListener('resize', () => this.handleResize());

        const authenticated = await bootstrapAuthSession();
        await this.loadScene(authenticated ? 'lobby' : 'login');

        console.log('[GameApp] Initialized');
    }

    private handleResize(): void {
        const w = this.viewportEl instanceof Window ? this.viewportEl.innerWidth : this.viewportEl.clientWidth;
        const h = this.viewportEl instanceof Window ? this.viewportEl.innerHeight : this.viewportEl.clientHeight;

        // Use contain scaling to avoid any left/right cropping.
        const scaleX = w / DESIGN_WIDTH;
        const scaleY = h / DESIGN_HEIGHT;
        const scale = Math.min(scaleX, scaleY);

        // Apply scale to stage
        this.app.stage.scale.set(scale);

        // Center the stage
        const stageX = (w - DESIGN_WIDTH * scale) / 2;
        const stageY = (h - DESIGN_HEIGHT * scale) / 2;
        this.app.stage.x = stageX;
        this.app.stage.y = stageY;

        // Expose stage bounds to DOM overlay for pixel alignment.
        const stageW = DESIGN_WIDTH * scale;
        const stageH = DESIGN_HEIGHT * scale;
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--stage-x', `${stageX}px`);
        rootStyle.setProperty('--stage-y', `${stageY}px`);
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
            this.currentScene.destroy({ children: true });
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
}

// Bootstrap
const game = new GameApp();
game.init().catch(console.error);

export { DESIGN_HEIGHT, DESIGN_WIDTH, GameApp };

