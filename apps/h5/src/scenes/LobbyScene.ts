import { Container, Graphics, Text } from 'pixi.js';
import type { GameApp } from '../main';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../main';

export class LobbyScene extends Container {
    constructor(game: GameApp) {
        super();
        void game;

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
