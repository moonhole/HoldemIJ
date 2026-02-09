import { Container, Graphics } from 'pixi.js';
import type { GameApp } from '../main';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../main';

export class LobbyScene extends Container {
    constructor(game: GameApp) {
        super();
        void game;

        // Background
        const bg = new Graphics();
        bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        bg.fill({ color: 0x0a0609 });
        this.addChild(bg);
    }
}

