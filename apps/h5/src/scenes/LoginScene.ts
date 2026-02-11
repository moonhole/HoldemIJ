import { Container, Graphics, Ticker } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameApp } from '../main';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../main';

const COLORS = {
    bg: 0x050205,
    cyan: 0x00f3ff,
    magenta: 0xf425af,
    white: 0xffffff,
};

export class LoginScene extends Container {
    private particles: { x: number; y: number; vx: number; vy: number; sprite: Graphics; size: number }[] = [];
    private particleCount = 40;
    private grid: Graphics;
    private _ticker: (t: any) => void;
    private isGlitching = false;

    constructor(game: GameApp) {
        super();
        void game;

        // 1. Dark Background
        const bg = new Graphics();
        bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        bg.fill({ color: COLORS.bg });
        this.addChild(bg);

        // 2. Cyber Grid
        this.grid = new Graphics();
        this.updateGrid(0.04);
        this.addChild(this.grid);

        // 3. Stardust Particles
        this.initParticles();

        // 4. Glitch Listener
        (window as any).__TRIGGER_LOGIN_GLITCH = () => this.triggerGlitch();

        // 5. Update Loop
        this._ticker = (t: any) => this.update(t.deltaTime);
        Ticker.shared.add(this._ticker);
    }

    private updateGrid(alpha: number) {
        this.grid.clear();
        const step = 60;
        this.grid.beginPath();
        for (let x = 0; x <= DESIGN_WIDTH; x += step) {
            this.grid.moveTo(x, 0);
            this.grid.lineTo(x, DESIGN_HEIGHT);
        }
        for (let y = 0; y <= DESIGN_HEIGHT; y += step) {
            this.grid.moveTo(0, y);
            this.grid.lineTo(DESIGN_WIDTH, y);
        }
        this.grid.stroke({ color: COLORS.cyan, width: 1, alpha: alpha });
    }

    private initParticles() {
        for (let i = 0; i < this.particleCount; i++) {
            const size = Math.random() * 2 + 1;
            const p = new Graphics();
            p.circle(0, 0, size);
            p.fill({ color: i % 2 === 0 ? COLORS.cyan : COLORS.white, alpha: Math.random() * 0.5 + 0.2 });

            const particle = {
                x: Math.random() * DESIGN_WIDTH,
                y: Math.random() * DESIGN_HEIGHT,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                sprite: p,
                size: size
            };

            p.x = particle.x;
            p.y = particle.y;
            this.addChild(p);
            this.particles.push(particle);
        }
    }

    private update(delta: number) {
        if (this.isGlitching) return;

        for (const p of this.particles) {
            p.x += p.vx * delta;
            p.y += p.vy * delta;

            if (p.x < 0) p.x = DESIGN_WIDTH;
            if (p.x > DESIGN_WIDTH) p.x = 0;
            if (p.y < 0) p.y = DESIGN_HEIGHT;
            if (p.y > DESIGN_HEIGHT) p.y = 0;

            p.sprite.x = p.x;
            p.sprite.y = p.y;
        }
    }

    public triggerGlitch() {
        if (this.isGlitching) return;
        this.isGlitching = true;

        const tl = gsap.timeline({
            onComplete: () => {
                this.isGlitching = false;
                this.x = 0;
                this.y = 0;
                this.scale.set(1);
                this.alpha = 1;
                this.removeChildren(); // Re-add bg so it's not empty if login fails
                const bg = new Graphics();
                bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
                bg.fill({ color: COLORS.bg });
                this.addChildAt(bg, 0);
                this.addChild(this.grid);
                this.particles.forEach(p => this.addChild(p.sprite));
            }
        });

        // Fast violent glitch sequence
        for (let i = 0; i < 8; i++) {
            tl.to(this, {
                x: (Math.random() - 0.5) * 40,
                y: (Math.random() - 0.5) * 40,
                alpha: Math.random() * 0.4 + 0.6,
                duration: 0.04,
                ease: "none"
            });

            // Random color overlay flashes
            tl.add(() => {
                const overlay = new Graphics();
                overlay.rect(0, Math.random() * DESIGN_HEIGHT, DESIGN_WIDTH, Math.random() * 100);
                overlay.fill({ color: Math.random() > 0.5 ? COLORS.cyan : COLORS.magenta, alpha: 0.4 });
                this.addChild(overlay);
                gsap.to(overlay, { alpha: 0, duration: 0.1, onComplete: () => overlay.destroy() });
            }, "-=0.02");
        }

        tl.to(this, { x: 0, y: 0, alpha: 1, duration: 0.05 });
    }

    public dispose() {
        Ticker.shared.remove(this._ticker);
        (window as any).__TRIGGER_LOGIN_GLITCH = null;
    }
}

