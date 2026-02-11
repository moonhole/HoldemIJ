import { Container, Graphics } from 'pixi.js';
import type { GameApp } from '../main';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../main';

export class LoginScene extends Container {
    constructor(game: GameApp) {
        super();
        void game;

        const bg = new Graphics();
        bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        bg.fill({ color: 0x08070a });
        this.addChild(bg);
    }
}
