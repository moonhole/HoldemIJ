import { Container, Graphics, Text } from 'pixi.js';
import type { GameApp } from '../main';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../main';

export class BootScene extends Container {
    private game: GameApp;
    private loadingText: Text;
    private progressBar: Graphics;
    private progressBg: Graphics;

    constructor(game: GameApp) {
        super();
        this.game = game;

        // Background gradient simulation
        const bg = new Graphics();
        bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        bg.fill({ color: 0x0a0a0f });
        this.addChild(bg);

        // Title
        const title = new Text({
            text: 'HOLDEM',
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: 72,
                fontWeight: '700',
                fill: 0xffffff,
                letterSpacing: 8,
            },
        });
        title.anchor.set(0.5);
        title.x = DESIGN_WIDTH / 2;
        title.y = DESIGN_HEIGHT / 2 - 80;
        this.addChild(title);

        // Subtitle
        const subtitle = new Text({
            text: 'Texas Hold\'em Poker',
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: 24,
                fontWeight: '400',
                fill: 0x888888,
            },
        });
        subtitle.anchor.set(0.5);
        subtitle.x = DESIGN_WIDTH / 2;
        subtitle.y = DESIGN_HEIGHT / 2 - 10;
        this.addChild(subtitle);

        // Progress bar background
        const barWidth = 400;
        const barHeight = 8;
        this.progressBg = new Graphics();
        this.progressBg.roundRect(0, 0, barWidth, barHeight, 4);
        this.progressBg.fill({ color: 0x222222 });
        this.progressBg.x = (DESIGN_WIDTH - barWidth) / 2;
        this.progressBg.y = DESIGN_HEIGHT / 2 + 60;
        this.addChild(this.progressBg);

        // Progress bar
        this.progressBar = new Graphics();
        this.progressBar.x = this.progressBg.x;
        this.progressBar.y = this.progressBg.y;
        this.addChild(this.progressBar);

        // Loading text
        this.loadingText = new Text({
            text: 'Loading...',
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: 16,
                fill: 0x666666,
            },
        });
        this.loadingText.anchor.set(0.5);
        this.loadingText.x = DESIGN_WIDTH / 2;
        this.loadingText.y = DESIGN_HEIGHT / 2 + 100;
        this.addChild(this.loadingText);

        // Start loading
        this.startLoading();
    }

    private async startLoading(): Promise<void> {
        // Simulate asset loading (replace with real asset loading later)
        const steps = [
            { progress: 0.2, text: 'Loading textures...' },
            { progress: 0.5, text: 'Loading sounds...' },
            { progress: 0.8, text: 'Connecting...' },
            { progress: 1.0, text: 'Ready!' },
        ];

        for (const step of steps) {
            this.updateProgress(step.progress, step.text);
            await this.delay(300);
        }

        // Transition to lobby after short delay
        await this.delay(500);
        this.game.loadScene('lobby');
    }

    private updateProgress(progress: number, text: string): void {
        const barWidth = 400;
        const barHeight = 8;

        this.progressBar.clear();
        this.progressBar.roundRect(0, 0, barWidth * progress, barHeight, 4);
        this.progressBar.fill({ color: 0x4ade80 });

        this.loadingText.text = text;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
