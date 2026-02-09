import { Application, Container } from 'pixi.js';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { requireCanvas, requireUiRoot } from './architecture/boundary';
import { bindGameClientToStore } from './store/gameStore';
import { useUiStore, type SceneName } from './store/uiStore';
import { UiLayerApp } from './ui/UiLayerApp';

// Design dimensions (mobile-first, portrait orientation)
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;

class GameApp {
    private app: Application;
    private currentScene: Container | null = null;
    private currentSceneName: SceneName = 'boot';
    private uiRoot: Root | null = null;
    private unsubscribeUiStore: (() => void) | null = null;

    constructor() {
        this.app = new Application();
    }

    async init(): Promise<void> {
        // Pixi and React mount points are separated by boundary contract.
        const canvas = requireCanvas();
        const uiLayer = requireUiRoot();
        bindGameClientToStore();

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
            background: '#0a0a0f',
            resizeTo: window,
            antialias: true,
            resolution: Math.min(window.devicePixelRatio, 2),
            autoDensity: true,
        });

        // Setup resize handling
        this.handleResize();
        window.addEventListener('resize', () => this.handleResize());

        // Load boot scene
        await this.loadScene('boot');

        console.log('[GameApp] Initialized');
    }

    private handleResize(): void {
        const { innerWidth: w, innerHeight: h } = window;

        // Calculate scale to fit design within viewport
        const scaleX = w / DESIGN_WIDTH;
        const scaleY = h / DESIGN_HEIGHT;
        const scale = Math.min(scaleX, scaleY);

        // Apply scale to stage
        this.app.stage.scale.set(scale);

        // Center the stage
        this.app.stage.x = (w - DESIGN_WIDTH * scale) / 2;
        this.app.stage.y = (h - DESIGN_HEIGHT * scale) / 2;
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

export { GameApp, DESIGN_WIDTH, DESIGN_HEIGHT };
