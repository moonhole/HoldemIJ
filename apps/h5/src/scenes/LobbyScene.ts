import { Container, Graphics, Text } from 'pixi.js';
import type { GameApp } from '../main';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../main';

export class LobbyScene extends Container {
    private game: GameApp;

    constructor(game: GameApp) {
        super();
        this.game = game;

        // Background
        const bg = new Graphics();
        bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        bg.fill({ color: 0x0d0d12 });
        this.addChild(bg);

        // Header
        const headerBg = new Graphics();
        headerBg.rect(0, 0, DESIGN_WIDTH, 120);
        headerBg.fill({ color: 0x14141a });
        this.addChild(headerBg);

        const headerTitle = new Text({
            text: 'HOLDEM',
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: 36,
                fontWeight: '700',
                fill: 0xffffff,
                letterSpacing: 4,
            },
        });
        headerTitle.anchor.set(0.5);
        headerTitle.x = DESIGN_WIDTH / 2;
        headerTitle.y = 60;
        this.addChild(headerTitle);

        // Quick Start Button
        const btnWidth = 600;
        const btnHeight = 100;
        const btn = new Graphics();
        btn.roundRect(0, 0, btnWidth, btnHeight, 16);
        btn.fill({ color: 0x22c55e });
        btn.x = (DESIGN_WIDTH - btnWidth) / 2;
        btn.y = DESIGN_HEIGHT / 2 - btnHeight / 2;
        btn.eventMode = 'static';
        btn.cursor = 'pointer';
        this.addChild(btn);

        const btnText = new Text({
            text: 'Quick Start - 6 Max',
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: 28,
                fontWeight: '600',
                fill: 0xffffff,
            },
        });
        btnText.anchor.set(0.5);
        btnText.x = btn.x + btnWidth / 2;
        btnText.y = btn.y + btnHeight / 2;
        this.addChild(btnText);

        // Button press effect
        btn.on('pointerdown', () => {
            btn.scale.set(0.95);
            btnText.scale.set(0.95);
        });

        btn.on('pointerup', async () => {
            btn.scale.set(1);
            btnText.scale.set(1);

            // Update button text to show connecting
            btnText.text = 'Connecting...';
            btn.eventMode = 'none';

            try {
                // Import and connect
                const { gameClient } = await import('../network/GameClient');
                await gameClient.connect();

                // Join table
                gameClient.joinTable();

                // Wait for join, then auto sit down
                setTimeout(() => {
                    btnText.text = 'Sitting down...';
                    // Sit at a random seat (0-5) with 10000 chips
                    // TODO: In future, let user choose seat or server assigns
                    const randomSeat = Math.floor(Math.random() * 6);
                    gameClient.myChair = randomSeat;
                    gameClient.sitDown(randomSeat, 10000n);

                    // Transition to table scene
                    setTimeout(() => {
                        this.game.loadScene('table');
                    }, 500);
                }, 300);
            } catch (error) {
                console.error('Failed to connect:', error);
                btnText.text = 'Connection Failed - Retry';
                btn.eventMode = 'static';
            }
        });

        btn.on('pointerupoutside', () => {
            btn.scale.set(1);
            btnText.scale.set(1);
        });

        // Room info
        const roomInfo = new Text({
            text: 'Blinds: 50 / 100  •  Buy-in: 5,000 - 10,000',
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: 20,
                fill: 0x666666,
            },
        });
        roomInfo.anchor.set(0.5);
        roomInfo.x = DESIGN_WIDTH / 2;
        roomInfo.y = btn.y + btnHeight + 40;
        this.addChild(roomInfo);
    }
}
