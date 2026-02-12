import type { ActionPrompt, ActionResult, Card, DealBoard, DealHoleCards, HandEnd, HandStart, PhaseChange, PlayerState, Pot, PotUpdate, SeatUpdate, Showdown, TableSnapshot, WinByFold } from '@gen/messages_pb';
import { ActionType, HandRank, Phase, Rank, Suit } from '@gen/messages_pb';
import { gsap } from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { audioManager } from '../audio/AudioManager';
import { SoundMap } from '../audio/SoundMap';
import type { GameApp } from '../main';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../main';
import { gameClient } from '../network/GameClient';
import { useReplayStore } from '../replay/replayStore';
import { useGameStore } from '../store/gameStore';

// Colors from cyber-poker design
const COLORS = {
    bgDark: 0x070407,       // Pure dark
    bgDesk: 0x1a1a3d,       // Even clearer Deep Navy for table
    bgConsole: 0x1a0c16,    // Dark Magenta for Console
    primary: 0xf425af,
    cyan: 0x00f3ff,
    white10: 0x1a1a1a,
    white20: 0x333333,
    cardRed: 0xf425af,      // Pink for hearts/diamonds
    cardBlack: 0xffffff,    // White for spades/clubs
};

// Seat positions (clockwise relative to Bottom Center)
const SEAT_POSITIONS = [
    { x: DESIGN_WIDTH * 0.50, y: 840 },   // [0] Bottom Center (Hero spot)
    { x: DESIGN_WIDTH * 0.15, y: 700 },   // [1] Bottom Left
    { x: DESIGN_WIDTH * 0.15, y: 300 },   // [2] Top Left
    { x: DESIGN_WIDTH * 0.50, y: 160 },   // [3] Top Center (Opposite)
    { x: DESIGN_WIDTH * 0.85, y: 300 },   // [4] Top Right
    { x: DESIGN_WIDTH * 0.85, y: 700 },   // [5] Bottom Right
];

const DECK_POS = { x: DESIGN_WIDTH / 2, y: 400 };
type ReplayApplyOptions = { silentFx?: boolean };

export class TableScene extends Container {
    private _game: GameApp;
    private potText!: Text;
    private potAmount!: Text;
    private currencySymbol!: Text;
    private potValueContainer!: Container;
    private actionTimerContainer!: Container;
    private actionTimerLabel!: Text;
    private actionTimerValue!: Text;
    private communityCards!: Container;
    private seatViews: SeatView[] = [];
    private myCards!: Container;
    private actionPanel!: Container;
    private myChair: number = -1;
    private boardCards: Card[] = [];
    private currentActionPrompt: ActionPrompt | null = null;
    private actionCountdownTimer: number | null = null;
    private fallbackCountdownStartMs = 0;
    private fallbackCountdownLimitMs = 0;
    private unsubscribeStore: (() => void) | null = null;
    private _potTickerValue = { val: 0 };
    private lastPotTotal = 0n;
    private lastChipCollectSoundAt = 0;

    // Showdown overlay state
    private showdownOverlay: Container | null = null;
    private showdownTimeline: gsap.core.Timeline | null = null;
    private highlightedCardIndices: Set<number> = new Set();
    private cardHighlightGraphics: Graphics[] = [];

    constructor(game: GameApp) {
        super();
        this._game = game;

        // 1. Base Layer (Everything Dark)
        const bg = new Graphics();
        bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        bg.fill({ color: COLORS.bgDark });
        this.addChild(bg);

        // 2. Table Desk (The Play Area - Middle)
        const tabletop = new Graphics();
        const tabletopY = 80; // Final adjustment for top-row visibility
        const consoleHeight = 680; // Taller console area
        const tabletopBottom = DESIGN_HEIGHT - consoleHeight;
        const tabletopH = tabletopBottom - tabletopY;
        tabletop.rect(0, tabletopY, DESIGN_WIDTH, tabletopH);
        tabletop.fill({ color: COLORS.bgDesk }); // Full opacity for better contrast
        // More visible edge lighting
        tabletop.stroke({ color: COLORS.cyan, width: 2, alpha: 0.25 });
        this.addChild(tabletop);

        // 2.5 Add a techy pattern to the desk - Moving Grid
        const gridContainer = new Container();
        const gridMask = new Graphics();
        gridMask.rect(0, tabletopY, DESIGN_WIDTH, tabletopH);
        gridMask.fill(0xffffff);
        gridContainer.mask = gridMask;
        this.addChild(gridMask);
        this.addChild(gridContainer);

        const deskGrid = new Graphics();
        const gridSize = 100;
        // Draw extra vertical lines for smooth infinite movement
        for (let x = -gridSize; x <= DESIGN_WIDTH + gridSize; x += gridSize) {
            deskGrid.moveTo(x, tabletopY).lineTo(x, tabletopY + tabletopH);
        }
        // Horizontal lines
        for (let y = tabletopY; y <= tabletopY + tabletopH; y += gridSize) {
            deskGrid.moveTo(-gridSize, y).lineTo(DESIGN_WIDTH + gridSize, y);
        }
        deskGrid.stroke({ color: COLORS.cyan, width: 1, alpha: 0.12 });
        gridContainer.addChild(deskGrid);

        // Infinite slow scroll to the right
        gsap.to(deskGrid, {
            x: gridSize,
            duration: 10,
            repeat: -1,
            ease: 'none'
        });

        // 3. Console/Hand Area (Bottom)
        // We make this distinct with a dark magenta theme
        const consoleY = DESIGN_HEIGHT - consoleHeight;
        const consoleArea = new Graphics();
        consoleArea.rect(0, consoleY, DESIGN_WIDTH, consoleHeight);
        consoleArea.fill({ color: COLORS.bgConsole });
        consoleArea.stroke({ color: COLORS.primary, width: 2, alpha: 0.2, alignment: 0 });
        this.addChild(consoleArea);

        // 4. Add a decorative grid to the console for "Cyber" feel
        const grid = new Graphics();
        for (let x = 0; x <= DESIGN_WIDTH; x += 30) {
            grid.moveTo(x, consoleY).lineTo(x, DESIGN_HEIGHT);
        }
        for (let y = consoleY; y <= DESIGN_HEIGHT; y += 30) {
            grid.moveTo(0, y).lineTo(DESIGN_WIDTH, y);
        }
        grid.stroke({ color: COLORS.primary, width: 1, alpha: 0.04 });
        this.addChild(grid);

        this.createTopBar();
        this.createPotDisplay();
        this.createActionTimer();
        this.createSeatGrid();
        this.createCommunityCards();
        this.createActionPanel();

        this.setupHandlers();
        this.applyCachedState();
        this.updateSeats();
    }

    private createTopBar(): void {
        const topBar = new Container();
        topBar.y = 40;
        this.addChild(topBar);

        const signal = new Text({
            text: '\u25AE \u25AE \u25AE \u25AE',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 8,
                fill: COLORS.cyan,
                dropShadow: { color: COLORS.cyan, alpha: 0.5, blur: 5, distance: 0 }
            },
        });
        signal.x = 30;
        signal.y = -2;
        topBar.addChild(signal);

        const tableName = new Text({
            text: 'TABLE_402_CORE',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 11,
                letterSpacing: 4,
                fill: 0x555555,
                fontWeight: '600',
            },
        });
        tableName.x = 85;
        tableName.y = -2;
        topBar.addChild(tableName);

        /*
                const settingsBtn = new Graphics();
                settingsBtn.circle(DESIGN_WIDTH - 85, 0, 18);
                settingsBtn.fill({ color: 0x2a0818 });
                settingsBtn.stroke({ color: COLORS.primary, width: 2, alpha: 0.5 });
                topBar.addChild(settingsBtn);
                const settingsIcon = new Text({
                    text: '\u2699',
                    style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 18, fill: COLORS.primary },
                });
                settingsIcon.anchor.set(0.5);
                settingsIcon.x = DESIGN_WIDTH - 85;
                topBar.addChild(settingsIcon);
        
                const chatBtn = new Graphics();
                chatBtn.circle(DESIGN_WIDTH - 40, 0, 18);
                chatBtn.fill({ color: 0x061a1a });
                chatBtn.stroke({ color: COLORS.cyan, width: 2, alpha: 0.5 });
                topBar.addChild(chatBtn);
                const chatIcon = new Text({
                    text: '\u{1F5E8}',
                    style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 16, fill: COLORS.cyan },
                });
                chatIcon.anchor.set(0.5);
                chatIcon.x = DESIGN_WIDTH - 40;
                topBar.addChild(chatIcon);
        */
    }

    private createPotDisplay(): void {
        const potContainer = new Container();
        potContainer.x = DESIGN_WIDTH / 2;
        potContainer.y = 380; // Sunk to clear space for top-row player metadata
        this.addChild(potContainer);

        this.potText = new Text({
            text: 'TOTAL POT',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 12, // Increased from 10
                letterSpacing: 4,
                fill: 0x666666,
                fontWeight: '700',
            },
        });
        this.potText.anchor.set(0.5);
        this.potText.y = -42; // Adjusted from -35
        potContainer.addChild(this.potText);

        this.potValueContainer = new Container();
        this.potValueContainer.y = 10;
        potContainer.addChild(this.potValueContainer);

        this.currencySymbol = new Text({
            text: '$',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 42, // Increased from 34
                fontWeight: '900',
                fontStyle: 'italic',
                fill: COLORS.primary,
            },
        });
        this.currencySymbol.anchor.set(1, 0.5);
        this.currencySymbol.x = -10; // Adjusted from -8
        this.potValueContainer.addChild(this.currencySymbol);

        this.potAmount = new Text({
            text: '0',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 68, // Increased from 54
                fontWeight: '900',
                fontStyle: 'italic',
                fill: 0xffffff,
                letterSpacing: 2,
                padding: 12,
            },
        });
        this.potAmount.anchor.set(0, 0.5);
        this.potValueContainer.addChild(this.potAmount);
    }

    private actionTimerRing!: Graphics;
    private actionTimerBg!: Graphics;

    private createActionTimer(): void {
        this.actionTimerContainer = new Container();
        this.actionTimerContainer.x = DESIGN_WIDTH / 2;
        this.actionTimerContainer.y = 650; // Sunk to match the adjusted community card flow
        this.actionTimerContainer.visible = false;
        this.addChild(this.actionTimerContainer);

        // Reactor Core Background
        this.actionTimerBg = new Graphics();
        this.drawReactorHUD(this.actionTimerBg);
        this.actionTimerContainer.addChild(this.actionTimerBg);

        // Progress Ring Track
        const ringTrack = new Graphics();
        ringTrack.arc(0, 0, 60, 0, Math.PI * 2); // Increased from 48
        ringTrack.stroke({ color: 0xffffff, width: 2, alpha: 0.05 });
        this.actionTimerContainer.addChild(ringTrack);

        // Progress Ring
        this.actionTimerRing = new Graphics();
        this.actionTimerContainer.addChild(this.actionTimerRing);

        this.actionTimerLabel = new Text({
            text: 'TO ACT',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 12, // Increased from 10
                letterSpacing: 1.5,
                fontWeight: '700',
                fill: 0x88d9df,
            },
        });
        this.actionTimerLabel.alpha = 0.7;
        this.actionTimerLabel.anchor.set(0.5);
        this.actionTimerLabel.y = -22; // Adjusted from -18
        this.actionTimerContainer.addChild(this.actionTimerLabel);

        this.actionTimerValue = new Text({
            text: '0',
            style: {
                fontFamily: 'Orbitron, Space Grotesk, Inter, sans-serif',
                fontSize: 36, // Increased from 28
                fontWeight: '900',
                fill: COLORS.cyan,
            },
        });
        this.actionTimerValue.anchor.set(0.5);
        this.actionTimerValue.y = 6;
        this.actionTimerContainer.addChild(this.actionTimerValue);
    }

    private drawReactorHUD(g: Graphics): void {
        g.clear();
        // Inner Glow
        g.circle(0, 0, 52);
        g.fill({ color: 0x031114, alpha: 0.6 });
        g.stroke({ color: COLORS.cyan, width: 2, alpha: 0.2 });

        // HUD Bracket Left
        g.moveTo(-85, -25).lineTo(-95, 0).lineTo(-85, 25); // Widened
        g.stroke({ color: COLORS.cyan, width: 3, alpha: 0.4 });

        // HUD Bracket Right
        g.moveTo(85, -25).lineTo(95, 0).lineTo(85, 25); // Widened
        g.stroke({ color: COLORS.cyan, width: 3, alpha: 0.4 });

        // Decorative bits
        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2 + Math.PI / 4;
            g.moveTo(Math.cos(angle) * 65, Math.sin(angle) * 65);
            g.lineTo(Math.cos(angle) * 75, Math.sin(angle) * 75);
            g.stroke({ color: COLORS.cyan, width: 1, alpha: 0.3 });
        }
    }

    private createSeatGrid(): void {
        for (let i = 0; i < 6; i++) {
            const pos = SEAT_POSITIONS[i];
            const seat = new SeatView(i);
            seat.x = pos.x;
            seat.y = pos.y;
            this.addChild(seat);
            this.seatViews.push(seat);
        }
    }

    private createCommunityCards(): void {
        this.communityCards = new Container();
        this.communityCards.x = DESIGN_WIDTH / 2;
        this.communityCards.y = 520; // Sunk to follow the pot expansion
        this.addChild(this.communityCards);
    }

    private createActionPanel(): void {
        this.actionPanel = new Container();
        // actionPanel matches the taller console height
        this.actionPanel.y = DESIGN_HEIGHT - 680;
        this.addChild(this.actionPanel);

        // myCards will sit "on top" of the console
        this.myCards = new Container();
        this.myCards.sortableChildren = true;
        this.myCards.zIndex = 300;
        this.myCards.x = DESIGN_WIDTH / 2;
        this.myCards.y = 80;
        this.actionPanel.addChild(this.myCards);
    }

    private setupHandlers(): void {
        this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
            this.myChair = state.myChair;
            if (state.streamSeq === prev.streamSeq || !state.lastEvent) return;
            const applyOptions: ReplayApplyOptions = { silentFx: useReplayStore.getState().silentFx };
            const event = state.lastEvent;
            switch (event.type) {
                case 'snapshot': this.handleSnapshot(event.value); break;
                case 'handStart': this.handleHandStart(event.value, applyOptions); break;
                case 'holeCards': this.handleHoleCards(event.value, applyOptions); break;
                case 'board': this.handleBoard(event.value, applyOptions); break;
                case 'potUpdate': this.handlePotUpdate(event.value, applyOptions); break;
                case 'phaseChange': this.handlePhaseChange(event.value, applyOptions); break;
                case 'actionPrompt': this.handleActionPrompt(event.value); break;
                case 'actionResult':
                    this.handleActionResult(event.value, applyOptions);
                    this.updatePot(event.value.newPotTotal, { instant: !!applyOptions.silentFx });
                    break;
                case 'handEnd': this.handleHandEnd(event.value, applyOptions); break;
                case 'seatUpdate': this.handleSeatUpdate(event.value); break;
                case 'showdown': this.handleShowdown(event.value, applyOptions); break;
                case 'winByFold': this.handleWinByFold(event.value, applyOptions); break;
            }
        });
    }

    private applyCachedState(): void {
        const state = useGameStore.getState();
        this.myChair = state.myChair;
        if (state.snapshot) this.handleSnapshot(state.snapshot);
        if (state.handStart) this.handleHandStart(state.handStart);
        if (state.holeCards) this.handleHoleCards(state.holeCards);
        if (state.actionPrompt) this.handleActionPrompt(state.actionPrompt);
        if (state.phaseChange) this.handlePhaseChange(state.phaseChange);
        if (state.potUpdate) this.handlePotUpdate(state.potUpdate);
    }

    private getPlayers(): PlayerState[] {
        return useGameStore.getState().snapshot?.players ?? [];
    }

    private handleSnapshot(snap: TableSnapshot): void {
        this.myChair = useGameStore.getState().myChair;
        this.hideActionCountdown();
        const totalPot = snap.pots.reduce((acc, p) => acc + p.amount, 0n);
        this._potTickerValue.val = Number(totalPot); // Set initial value without animation
        this.updatePotFromPots(snap.pots, { silent: true });
        this.updateSeats();
        this.updateActivePlayer(snap.actionChair);
        this.boardCards = [...snap.communityCards];
        this.updateCommunityCards(this.boardCards);

        // Show my cards if I'm already in a hand
        const me = snap.players.find(p => p.chair === this.myChair);
        if (me && me.handCards && me.handCards.length > 0 && !me.folded) {
            this.showMyCards(me.handCards);
        }
    }

    private handleSeatUpdate(update: SeatUpdate): void {
        if (update.chair === useGameStore.getState().myChair) {
            this.myChair = update.chair;
        }
        this.updateSeats();
    }

    private updateSeats(options?: ReplayApplyOptions): void {
        const players = this.getPlayers();
        for (let chair = 0; chair < 6; chair++) {
            let viewIndex = (this.myChair !== -1) ? (chair - this.myChair + 6) % 6 : chair % 6;
            const view = this.seatViews[viewIndex];
            const player = players.find(p => p.chair === chair);

            if (player) {
                view.setPlayer(player, chair === this.myChair, { instant: !!options?.silentFx });
            } else {
                view.clear();
            }
        }
    }

    private updateActivePlayer(actionChair: number): void {
        this.seatViews.forEach(sv => sv.setActive(false));
        if (actionChair < 0 || actionChair >= this.seatViews.length) return;

        let viewIndex = -1;
        if (this.myChair !== -1) {
            viewIndex = (actionChair - this.myChair + 6) % 6;
        } else {
            viewIndex = actionChair % 6;
        }

        if (viewIndex !== -1 && this.seatViews[viewIndex]) {
            this.seatViews[viewIndex].setActive(true);
        }
    }

    private handleHandStart(start: HandStart, options?: ReplayApplyOptions): void {
        // Clean up any showdown overlays from the previous hand
        this.cleanupShowdown();

        const silentFx = !!options?.silentFx;
        if (!silentFx) {
            audioManager.play(SoundMap.GAME_START);
        }
        this.myCards.removeChildren();
        this.communityCards.removeChildren();
        this.boardCards = [];
        this.lastPotTotal = 0n;
        this.updatePot(0n, { instant: silentFx });
        this.hideActionCountdown();

        for (const sv of this.seatViews) sv.clearCards();

        // Update seats to show blinds (already updated in gameStore)
        this.updateSeats(options);

        // Update dealer buttons
        for (let chair = 0; chair < 6; chair++) {
            let viewIndex = (this.myChair !== -1) ? (chair - this.myChair + 6) % 6 : chair % 6;
            const view = this.seatViews[viewIndex];
            view.setDealer(chair === start.dealerChair);
        }

        this.updateActivePlayer(-1);
    }

    private handleHoleCards(deal: DealHoleCards, options?: ReplayApplyOptions): void {
        this.showMyCards(deal.cards, { instant: !!options?.silentFx });

        // For other players, we show card backs at their seats (animated in updateSeats logic)
        this.updateSeats(options);
    }

    private handleBoard(board: DealBoard, options?: ReplayApplyOptions): void {
        if (board.phase === Phase.FLOP) {
            this.boardCards = [...board.cards];
        } else {
            this.boardCards = [...this.boardCards, ...board.cards];
            if (board.phase === Phase.TURN) this.boardCards = this.boardCards.slice(0, 4);
            else if (board.phase === Phase.RIVER) this.boardCards = this.boardCards.slice(0, 5);
        }
        this.updateCommunityCards(this.boardCards, { instant: !!options?.silentFx });
    }

    private handlePotUpdate(update: PotUpdate, options?: ReplayApplyOptions): void {
        this.updatePotFromPots(update.pots, { silent: !!options?.silentFx, instant: !!options?.silentFx });
    }

    private handlePhaseChange(phaseChange: PhaseChange, options?: ReplayApplyOptions): void {
        this.boardCards = [...phaseChange.communityCards];
        this.updateCommunityCards(this.boardCards, { instant: !!options?.silentFx });
        this.updatePotFromPots(phaseChange.pots, { silent: !!options?.silentFx, instant: !!options?.silentFx });
        this.updateSeats(options);
    }

    private handleActionResult(result: ActionResult, options?: ReplayApplyOptions): void {
        this.hideActionCountdown();
        if (result.action === ActionType.ACTION_FOLD && result.chair === this.myChair) {
            this.myCards.removeChildren();
        }
        if (!options?.silentFx && result.chair !== this.myChair) {
            this.playActionResultSound(result.action);
        }
        this.updateSeats(options);
    }

    private handleActionPrompt(prompt: ActionPrompt): void {
        if (this.myChair === -1) {
            const storeChair = useGameStore.getState().myChair;
            this.myChair = storeChair !== -1 ? storeChair : prompt.chair;
            this.updateSeats();
        }
        this.updateActivePlayer(prompt.chair);
        if (this.shouldShowActionCountdown(prompt)) {
            this.showActionCountdown(prompt);
        } else {
            this.hideActionCountdown();
        }
    }

    private shouldShowActionCountdown(prompt: ActionPrompt): boolean {
        if (useReplayStore.getState().mode === 'loaded') {
            return false;
        }
        return prompt.timeLimitSec > 0 || prompt.actionDeadlineMs > 0n;
    }

    private showActionCountdown(prompt: ActionPrompt): void {
        this.currentActionPrompt = prompt;
        this.fallbackCountdownStartMs = Date.now();
        this.fallbackCountdownLimitMs = Math.max(0, prompt.timeLimitSec) * 1000;
        this.actionTimerContainer.visible = true;
        this.updateActionCountdown();

        if (this.actionCountdownTimer !== null) {
            window.clearInterval(this.actionCountdownTimer);
        }
        this.actionCountdownTimer = window.setInterval(() => {
            this.updateActionCountdown();
        }, 100);
    }

    private hideActionCountdown(): void {
        this.currentActionPrompt = null;
        this.actionTimerContainer.visible = false;
        if (this.actionCountdownTimer !== null) {
            window.clearInterval(this.actionCountdownTimer);
            this.actionCountdownTimer = null;
        }
    }

    private updateActionCountdown(): void {
        const prompt = this.currentActionPrompt;
        if (!prompt) {
            this.actionTimerContainer.visible = false;
            return;
        }
        if (!this.shouldShowActionCountdown(prompt)) {
            this.hideActionCountdown();
            return;
        }

        const actorLabel = this.getActionActorLabel(prompt.chair);
        this.actionTimerLabel.text = actorLabel;

        let remainingMs = 0;
        const totalLimitMs = prompt.timeLimitSec > 0 ? prompt.timeLimitSec * 1000 : 30000;

        if (prompt.actionDeadlineMs > 0n) {
            remainingMs = Number(prompt.actionDeadlineMs) - gameClient.getEstimatedServerNowMs();
        } else {
            const elapsedMs = Date.now() - this.fallbackCountdownStartMs;
            remainingMs = this.fallbackCountdownLimitMs - elapsedMs;
        }

        remainingMs = Math.max(0, remainingMs);
        const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
        const progress = Math.min(1, remainingMs / totalLimitMs);

        // Update Text
        this.actionTimerValue.text = `${remainingSec}`;

        // Color Transition: Cyan -> Orange -> Red
        let color = COLORS.cyan;
        if (progress < 0.3) color = 0xff4d4d; // Red
        else if (progress < 0.6) color = 0xffa500; // Orange

        this.actionTimerValue.style.fill = color;

        // Update Ring with segmented look
        this.actionTimerRing.clear();
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + (Math.PI * 2 * progress);

        // Outer glowing arc
        this.actionTimerRing.arc(0, 0, 55, startAngle, endAngle);
        this.actionTimerRing.stroke({ color, width: 4, cap: 'round', alpha: 0.8 });

        // Inner segmented track
        const segments = 24;
        for (let i = 0; i < segments; i++) {
            const angle = startAngle + (i / segments) * Math.PI * 2;
            const isFilled = (i / segments) < progress;
            if (isFilled) {
                this.actionTimerRing.moveTo(Math.cos(angle) * 56, Math.sin(angle) * 56);
                this.actionTimerRing.lineTo(Math.cos(angle) * 60, Math.sin(angle) * 60); // Adjusted from 44/48
                this.actionTimerRing.stroke({ color, width: 2, alpha: 0.6 });
            }
        }

        // Add a scanning line
        const scanAngle = (Date.now() * 0.005) % (Math.PI * 2);
        this.actionTimerRing.moveTo(0, 0);
        this.actionTimerRing.lineTo(Math.cos(scanAngle) * 55, Math.sin(scanAngle) * 55);
        this.actionTimerRing.stroke({ color, width: 1, alpha: 0.1 });

        // Pulse effect when low time
        if (remainingSec <= 5) {
            const pulse = 1 + Math.sin(Date.now() * 0.01) * 0.05;
            this.actionTimerContainer.scale.set(pulse);
        } else {
            this.actionTimerContainer.scale.set(1);
        }
    }

    private getActionActorLabel(chair: number): string {
        if (chair === this.myChair) {
            return 'YOU';
        }
        const actor = this.getPlayers().find((p) => p.chair === chair);
        if (actor) {
            return `PLAYER_${actor.userId.toString()}`;
        }
        return `CHAIR_${chair + 1}`;
    }

    private handleShowdown(showdown: Showdown, options?: ReplayApplyOptions): void {
        if (options?.silentFx) {
            this.cleanupShowdown();
            showdown.hands.forEach((hand) => {
                if (hand.chair === this.myChair) {
                    return;
                }
                const viewIndex = this.myChair !== -1
                    ? (hand.chair - this.myChair + 6) % 6
                    : hand.chair % 6;
                if (viewIndex >= 0 && viewIndex < this.seatViews.length) {
                    this.seatViews[viewIndex].showCards(hand.holeCards, false);
                }
            });
            return;
        }

        // Kill any prior showdown timeline
        this.cleanupShowdown();

        const tl = gsap.timeline();
        this.showdownTimeline = tl;

        // Collect winner chairs from pot results
        const winnerChairs = new Set<number>();
        for (const pr of showdown.potResults) {
            for (const w of pr.winners) {
                winnerChairs.add(w.chair);
            }
        }

        // Also collect from net results
        for (const nr of showdown.netResults) {
            if (nr.isWinner) winnerChairs.add(nr.chair);
        }

        // --- Phase 1: Reveal opponent hole cards (staggered) ---
        showdown.hands.forEach((hand, i) => {
            if (hand.chair !== this.myChair) {
                let viewIndex = -1;
                if (this.myChair !== -1) {
                    viewIndex = (hand.chair - this.myChair + 6) % 6;
                } else {
                    viewIndex = hand.chair % 6;
                }
                if (viewIndex >= 0 && viewIndex < this.seatViews.length) {
                    tl.add(() => {
                        this.seatViews[viewIndex].showCards(hand.holeCards, true);
                    }, i * 0.3);
                }
            }
        });

        // --- Phase 2: After cards revealed, highlight best5 on community + hand cards ---
        const revealDuration = Math.max(showdown.hands.length * 0.3 + 0.5, 1);

        // Find the primary winner's best5 for highlighting
        const primaryWinnerHand = showdown.hands.find(h => winnerChairs.has(h.chair));
        if (primaryWinnerHand && primaryWinnerHand.bestFive.length > 0) {
            tl.add(() => {
                this.highlightBest5Cards(primaryWinnerHand.bestFive, primaryWinnerHand.holeCards, primaryWinnerHand.chair);
            }, revealDuration);
        }

        // --- Phase 3: Show hand rank label in center ---
        if (primaryWinnerHand) {
            tl.add(() => {
                this.showHandRankOverlay(primaryWinnerHand.rank);
            }, revealDuration + 0.3);
        }

        // --- Phase 4: Highlight winner seat(s) ---
        for (const hand of showdown.hands) {
            if (winnerChairs.has(hand.chair)) {
                let viewIndex = -1;
                if (this.myChair !== -1) {
                    viewIndex = (hand.chair - this.myChair + 6) % 6;
                } else {
                    viewIndex = hand.chair % 6;
                }
                if (viewIndex >= 0 && viewIndex < this.seatViews.length) {
                    tl.add(() => {
                        this.seatViews[viewIndex].setWinner(true);
                    }, revealDuration + 0.5);
                }
            }
        }

        // --- Phase 5: Show per-winner win amount badges ---
        for (const nr of showdown.netResults) {
            if (nr.isWinner && nr.winAmount > 0n) {
                let viewIndex = -1;
                if (this.myChair !== -1) {
                    viewIndex = (nr.chair - this.myChair + 6) % 6;
                } else {
                    viewIndex = nr.chair % 6;
                }
                if (viewIndex >= 0 && viewIndex < this.seatViews.length) {
                    tl.add(() => {
                        this.seatViews[viewIndex].showWinAmount(nr.winAmount);
                    }, revealDuration + 0.8);
                }
            }
        }
    }

    /**
     * Highlights all cards that are part of the winning best-5:
     * community cards on the board AND hole cards in hand (hero or opponent seat).
     */
    private highlightBest5Cards(bestFive: Card[], holeCards: Card[], winnerChair: number): void {
        this.highlightedCardIndices.clear();
        this.clearCardHighlights();

        // --- 1. Match best5 cards to board card indices ---
        const boardCards = this.boardCards;
        const usedBoard: boolean[] = new Array(boardCards.length).fill(false);
        const matchedBest5: boolean[] = new Array(bestFive.length).fill(false);

        for (let b = 0; b < bestFive.length; b++) {
            const b5 = bestFive[b];
            for (let i = 0; i < boardCards.length; i++) {
                if (!usedBoard[i] && boardCards[i].suit === b5.suit && boardCards[i].rank === b5.rank) {
                    usedBoard[i] = true;
                    matchedBest5[b] = true;
                    this.highlightedCardIndices.add(i);
                    break;
                }
            }
        }

        // Add glowing highlights to matched community cards
        const cardW = 75;
        const cardH = 105;
        const gap = 10;
        const totalCards = 5;
        const totalWidth = totalCards * cardW + (totalCards - 1) * gap;
        const startX = -totalWidth / 2;

        this.highlightedCardIndices.forEach(idx => {
            const glow = new Graphics();
            const cx = startX + idx * (cardW + gap) + cardW / 2;
            const cy = 0;

            // Outer glow aura
            glow.roundRect(cx - cardW / 2 - 6, cy - cardH / 2 - 6, cardW + 12, cardH + 12, 12);
            glow.fill({ color: COLORS.cyan, alpha: 0.15 });
            glow.stroke({ color: COLORS.cyan, width: 3, alpha: 0.9 });

            // Inner brighter border
            glow.roundRect(cx - cardW / 2 - 2, cy - cardH / 2 - 2, cardW + 4, cardH + 4, 10);
            glow.stroke({ color: 0xffffff, width: 1, alpha: 0.5 });

            glow.alpha = 0;
            this.communityCards.addChild(glow);
            this.cardHighlightGraphics.push(glow);

            gsap.to(glow, { alpha: 1, duration: 0.4, ease: 'power2.out' });
            gsap.to(glow, { alpha: 0.6, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.4 });
        });

        // --- 2. Remaining unmatched best5 cards are hole cards — highlight them ---
        const holeCardsInBest5: Card[] = [];
        for (let b = 0; b < bestFive.length; b++) {
            if (!matchedBest5[b]) {
                holeCardsInBest5.push(bestFive[b]);
            }
        }

        if (holeCardsInBest5.length === 0) return;

        if (winnerChair === this.myChair) {
            // Highlight hero's hand cards in myCards
            this.highlightHeroHandCards(holeCardsInBest5);
        } else {
            // Highlight the winner's seat shown cards
            let viewIndex = -1;
            if (this.myChair !== -1) {
                viewIndex = (winnerChair - this.myChair + 6) % 6;
            } else {
                viewIndex = winnerChair % 6;
            }
            if (viewIndex >= 0 && viewIndex < this.seatViews.length) {
                this.seatViews[viewIndex].highlightCards(holeCardsInBest5, this.cardHighlightGraphics);
            }
        }
    }

    /**
     * Highlights the hero's hand cards (in myCards container) that are part of best5.
     */
    private highlightHeroHandCards(cardsToHighlight: Card[]): void {
        const heroCardW = 100;
        const heroCardH = 145;

        // myCards children are card containers with (card as any).cardData if we tag them
        // Since we didn't tag them, we need to match by the holeCards data from the store
        const state = useGameStore.getState();
        const myHoleCards = state.holeCards?.cards ?? [];

        for (const target of cardsToHighlight) {
            for (let i = 0; i < myHoleCards.length; i++) {
                if (myHoleCards[i].suit === target.suit && myHoleCards[i].rank === target.rank) {
                    const cardContainer = this.myCards.children[i] as Container;
                    if (!cardContainer) continue;

                    const glow = new Graphics();
                    // Draw glow relative to card center (cards are centered at their position)
                    glow.roundRect(-heroCardW / 2 - 8, -heroCardH / 2 - 8, heroCardW + 16, heroCardH + 16, 18);
                    glow.fill({ color: COLORS.cyan, alpha: 0.15 });
                    glow.stroke({ color: COLORS.cyan, width: 3, alpha: 0.9 });

                    glow.roundRect(-heroCardW / 2 - 3, -heroCardH / 2 - 3, heroCardW + 6, heroCardH + 6, 16);
                    glow.stroke({ color: 0xffffff, width: 1, alpha: 0.5 });

                    glow.alpha = 0;
                    cardContainer.addChild(glow);
                    this.cardHighlightGraphics.push(glow);

                    gsap.to(glow, { alpha: 1, duration: 0.4, ease: 'power2.out' });
                    gsap.to(glow, { alpha: 0.6, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.4 });
                    break;
                }
            }
        }
    }

    /**
     * Shows the hand rank label (e.g. "FULL HOUSE") as an overlay in the center.
     */
    private showHandRankOverlay(rank: HandRank): void {
        this.removeShowdownOverlay();

        const overlay = new Container();
        overlay.x = DESIGN_WIDTH / 2;
        overlay.y = 435;
        this.addChild(overlay);
        this.showdownOverlay = overlay;

        // Background panel with cyber aesthetic
        const bg = new Graphics();
        const panelW = 420;
        const panelH = 60;
        bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 8);
        bg.fill({ color: 0x050510, alpha: 0.85 });
        bg.stroke({ color: COLORS.cyan, width: 2, alpha: 0.7 });
        // Accent lines
        bg.moveTo(-panelW / 2 + 10, panelH / 2 - 3);
        bg.lineTo(panelW / 2 - 10, panelH / 2 - 3);
        bg.stroke({ color: COLORS.primary, width: 2, alpha: 0.4 });
        overlay.addChild(bg);

        // Rank text
        const label = new Text({
            text: this.getHandRankLabel(rank).toUpperCase(),
            style: {
                fontFamily: 'Orbitron, Space Grotesk, Inter, sans-serif',
                fontSize: 28,
                fontWeight: '900',
                letterSpacing: 6,
                fill: COLORS.cyan,
                dropShadow: { color: COLORS.cyan, alpha: 0.6, blur: 12, distance: 0 },
            },
        });
        label.anchor.set(0.5);
        overlay.addChild(label);

        // Animate in
        overlay.scale.set(0.3);
        overlay.alpha = 0;
        gsap.to(overlay.scale, { x: 1, y: 1, duration: 0.5, ease: 'back.out(1.7)' });
        gsap.to(overlay, { alpha: 1, duration: 0.3, ease: 'power2.out' });
    }

    private removeShowdownOverlay(): void {
        if (this.showdownOverlay) {
            gsap.killTweensOf(this.showdownOverlay);
            gsap.killTweensOf(this.showdownOverlay.scale);
            this.showdownOverlay.destroy({ children: true });
            this.showdownOverlay = null;
        }
    }

    private clearCardHighlights(): void {
        for (const g of this.cardHighlightGraphics) {
            gsap.killTweensOf(g);
            g.destroy();
        }
        this.cardHighlightGraphics = [];
    }

    private cleanupShowdown(): void {
        if (this.showdownTimeline) {
            this.showdownTimeline.kill();
            this.showdownTimeline = null;
        }
        this.removeShowdownOverlay();
        this.clearCardHighlights();
        this.highlightedCardIndices.clear();
        for (const sv of this.seatViews) {
            sv.setWinner(false);
            sv.clearWinAmount();
        }
    }

    private playActionResultSound(action: ActionType): void {
        switch (action) {
            case ActionType.ACTION_FOLD:
                audioManager.play(SoundMap.ACTION_FOLD);
                break;
            case ActionType.ACTION_CHECK:
                audioManager.play(SoundMap.ACTION_CHECK);
                break;
            case ActionType.ACTION_CALL:
                audioManager.play(SoundMap.ACTION_CALL);
                break;
            case ActionType.ACTION_RAISE:
                audioManager.play(SoundMap.ACTION_RAISE);
                break;
            case ActionType.ACTION_ALLIN:
                audioManager.play(SoundMap.ACTION_ALLIN);
                break;
            case ActionType.ACTION_BET:
                audioManager.play(SoundMap.CHIP_BET);
                break;
            default:
                break;
        }
    }

    private playChipCollectSound(): void {
        const now = Date.now();
        if (now - this.lastChipCollectSoundAt < 120) {
            return;
        }
        this.lastChipCollectSoundAt = now;
        audioManager.play(SoundMap.CHIP_COLLECT);
    }

    private handleHandEnd(end: HandEnd, options?: ReplayApplyOptions): void {
        if (!options?.silentFx) {
            audioManager.play(SoundMap.WIN_POT);
        }
        this.hideActionCountdown();
        this.updateActivePlayer(-1);
        this.updateSeats(options);
        this.lastPotTotal = 0n;
        this.updatePot(0n, { instant: !!options?.silentFx }); // Animate pot down to zero as chips flow to winners
    }

    private handleWinByFold(winByFold: WinByFold, options?: ReplayApplyOptions): void {
        this.hideActionCountdown();
        this.updateActivePlayer(-1);
        // We'll let handleHandEnd (which follows) handle the definitive stack updates
        // Just animate the pot clearing for visual feedback
        this.lastPotTotal = 0n;
        this.updatePot(0n, { instant: !!options?.silentFx });
    }

    private updatePotFromPots(pots: Pot[], options?: { silent?: boolean; instant?: boolean }): void {
        let potTotal = 0n;
        for (const pot of pots) potTotal += pot.amount;
        const changed = potTotal !== this.lastPotTotal;
        const increased = potTotal > this.lastPotTotal;
        this.lastPotTotal = potTotal;

        if (!options?.silent && changed && increased) {
            this.playChipCollectSound();
        }

        this.updatePot(potTotal, { instant: !!options?.instant });
    }

    private getHandRankLabel(rank: HandRank): string {
        switch (rank) {
            case HandRank.HIGH_CARD: return 'High Card';
            case HandRank.ONE_PAIR: return 'One Pair';
            case HandRank.TWO_PAIR: return 'Two Pair';
            case HandRank.THREE_OF_KIND: return 'Three of a Kind';
            case HandRank.STRAIGHT: return 'Straight';
            case HandRank.FLUSH: return 'Flush';
            case HandRank.FULL_HOUSE: return 'Full House';
            case HandRank.FOUR_OF_KIND: return 'Four of a Kind';
            case HandRank.STRAIGHT_FLUSH: return 'Straight Flush';
            case HandRank.ROYAL_FLUSH: return 'Royal Flush';
            default: return 'Unknown';
        }
    }

    private updatePot(amount: bigint, options?: { instant?: boolean }): void {
        const target = Number(amount);
        if (options?.instant) {
            gsap.killTweensOf(this._potTickerValue);
            this._potTickerValue.val = target;
            this.potAmount.text = Math.floor(this._potTickerValue.val).toLocaleString();
            const totalWidth = this.currencySymbol.width + 8 + this.potAmount.width;
            const centerBias = (this.potAmount.width - (this.currencySymbol.width + 8)) / 2;
            this.potValueContainer.x = -centerBias;
            return;
        }
        gsap.to(this._potTickerValue, {
            val: target,
            duration: 1.2,
            ease: 'power4.out',
            onUpdate: () => {
                this.potAmount.text = Math.floor(this._potTickerValue.val).toLocaleString();
                // Dynamic centering: offset the container to keep Symbol + Text unit centered
                const totalWidth = this.currencySymbol.width + 8 + this.potAmount.width;
                const centerBias = (this.potAmount.width - (this.currencySymbol.width + 8)) / 2;
                this.potValueContainer.x = -centerBias;
            }
        });
    }

    private showMyCards(cards: Card[], options?: { instant?: boolean }): void {
        // If cards are already shown and count matches, don't redo animation unless changed
        if (this.myCards.children.length === cards.length) return;

        this.myCards.removeChildren();
        const cardW = 100;
        const cardH = 145;
        const gap = 16;
        const totalWidth = cards.length * cardW + (cards.length - 1) * gap;
        const startX = -totalWidth / 2;

        cards.forEach((card, i) => {
            const cardView = this.createCard(card, cardW, cardH, true);
            cardView.zIndex = 300 + i;
            const targetX = startX + i * (cardW + gap) + cardW / 2;
            const targetRotation = (i - 0.5) * 0.12;

            if (options?.instant) {
                cardView.x = targetX;
                cardView.y = 0;
                cardView.rotation = targetRotation;
                cardView.alpha = 1;
                cardView.scale.set(1.2);
                const back = cardView.getChildByName('back');
                const front = cardView.getChildByName('front');
                if (back) back.visible = false;
                if (front) front.visible = true;
                this.myCards.addChild(cardView);
                return;
            }

            // Start from center of table (deck)
            // But myCards is a child of actionPanel, so we need to adjust
            const globalDeckX = DECK_POS.x;
            const globalDeckY = DECK_POS.y;
            const localPos = this.myCards.toLocal({ x: globalDeckX, y: globalDeckY });

            cardView.x = localPos.x;
            cardView.y = localPos.y;
            cardView.scale.set(0.2);
            cardView.alpha = 0;
            this.myCards.addChild(cardView);

            const tl = gsap.timeline({ delay: i * 0.2 });
            tl.add(() => {
                audioManager.play(SoundMap.CARD_DEAL, 0.8);
            });
            tl.to(cardView, {
                x: targetX,
                y: 0,
                rotation: targetRotation,
                alpha: 1,
                duration: 0.6,
                ease: 'power2.out'
            });
            tl.to(cardView.scale, { x: 1.2, y: 1.2, duration: 0.4, ease: 'back.out(1.7)' }, "-=0.4");

            // Flip animation
            tl.to(cardView.scale, { x: 0, duration: 0.15, ease: 'sine.in' });
            tl.add(() => {
                const back = cardView.getChildByName('back');
                const front = cardView.getChildByName('front');
                if (back) back.visible = false;
                if (front) front.visible = true;
                audioManager.play(SoundMap.CARD_FLIP, 0.8);
            });
            tl.to(cardView.scale, { x: 1.2, duration: 0.15, ease: 'sine.out' });
        });
    }

    private createCard(card: Card, width: number, height: number, isHero: boolean): Container {
        const container = new Container();

        // 1. Back Side
        const back = new Container();
        back.name = 'back';
        const backBg = new Graphics();
        backBg.roundRect(-width / 2, -height / 2, width, height, isHero ? 15 : 10);
        backBg.fill({ color: 0x050b14 }); // Uniform deep cyber back
        backBg.stroke({ color: COLORS.cyan, width: isHero ? 2 : 1.5, alpha: 0.5 });

        // Uniform X pattern for all cards
        const pattern = new Graphics();
        const pSize = width * 0.3;
        pattern.moveTo(-pSize, -pSize).lineTo(pSize, pSize);
        pattern.moveTo(pSize, -pSize).lineTo(-pSize, pSize);
        pattern.stroke({ color: COLORS.cyan, width: isHero ? 2 : 1, alpha: 0.2 });
        back.addChild(backBg, pattern);
        container.addChild(back);

        // 2. Front Side
        const front = new Container();
        front.name = 'front';
        front.visible = false;

        if (isHero) {
            const glow = new Graphics();
            glow.roundRect(-width / 2 - 8, -height / 2 - 8, width + 16, height + 16, 18);
            glow.fill({ color: COLORS.primary, alpha: 0.3 });
            front.addChild(glow);
        }

        const bg = new Graphics();
        bg.roundRect(-width / 2, -height / 2, width, height, isHero ? 15 : 10);
        bg.fill({ color: 0x080608 }); // Consistency: deep cyber dark 
        bg.stroke({
            color: isHero ? COLORS.primary : COLORS.cyan,
            width: isHero ? 3 : 1.5,
            alpha: isHero ? 0.8 : 0.25
        });
        front.addChild(bg);

        const isRed = card.suit === Suit.HEART || card.suit === Suit.DIAMOND;
        const color = isRed ? COLORS.cardRed : 0xe0ffff; // Cyan-tinted white for black suits

        const rankText = new Text({
            text: this.getRankString(card.rank),
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: isHero ? 40 : width * 0.45,
                fontWeight: '900',
                fill: color
            },
        });
        rankText.anchor.set(0.5);
        rankText.y = isHero ? -20 : -height * 0.12;
        front.addChild(rankText);

        const suitText = new Text({
            text: this.getSuitSymbol(card.suit),
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: isHero ? 48 : width * 0.55,
                fill: color
            },
        });
        suitText.anchor.set(0.5);
        suitText.y = isHero ? 35 : height * 0.18;
        front.addChild(suitText);

        container.addChild(front);
        return container;
    }

    private updateCommunityCards(cards: Card[], options?: { instant?: boolean }): void {
        const currentCount = this.communityCards.children.filter(c => c.name === 'card').length;
        if (currentCount === cards.length) return;

        const cardW = 75; // Increased from 55
        const cardH = 105; // Increased from 85
        const gap = 10; // Increased from 8
        const totalCards = 5;
        const totalWidth = totalCards * cardW + (totalCards - 1) * gap;
        const startX = -totalWidth / 2;

        // 1. Ensure placeholders are there (only on first call or clear)
        if (this.communityCards.children.length === 0) {
            for (let i = 0; i < totalCards; i++) {
                const placeholder = new Graphics();
                placeholder.name = 'placeholder';
                placeholder.roundRect(startX + i * (cardW + gap), -cardH / 2, cardW, cardH, 8);
                placeholder.fill({ color: 0x000000, alpha: 0.3 });
                placeholder.stroke({ color: 0x333333, width: 1, alpha: 0.5 });
                this.communityCards.addChild(placeholder);
            }
        }

        // 2. Add new cards
        cards.forEach((card, i) => {
            // Check if card at this index is already rendered
            const existing = this.communityCards.children.find(c => c.name === 'card' && (c as any).boardIndex === i);
            if (existing) return;

            const cardView = this.createCard(card, cardW, cardH, false);
            cardView.name = 'card';
            (cardView as any).boardIndex = i;

            // Spawn from deck
            const localDeck = this.communityCards.toLocal(DECK_POS);
            cardView.x = localDeck.x;
            cardView.y = localDeck.y;
            cardView.scale.set(0.1);
            cardView.alpha = 0;
            this.communityCards.addChild(cardView);

            const targetX = startX + i * (cardW + gap) + cardW / 2;
            if (options?.instant) {
                cardView.x = targetX;
                cardView.y = 0;
                cardView.alpha = 1;
                cardView.scale.set(1);
                cardView.getChildByName('back')!.visible = false;
                cardView.getChildByName('front')!.visible = true;
                return;
            }

            const tl = gsap.timeline({ delay: (i - currentCount) * 0.15 });
            tl.add(() => {
                audioManager.play(SoundMap.CARD_SLIDE, 0.8);
            });
            tl.to(cardView, {
                x: targetX,
                y: 0,
                alpha: 1,
                duration: 0.5,
                ease: 'power2.out'
            });
            tl.to(cardView.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out' }, "-=0.3");

            // Flip
            tl.to(cardView.scale, { x: 0, duration: 0.15 });
            tl.add(() => {
                cardView.getChildByName('back')!.visible = false;
                cardView.getChildByName('front')!.visible = true;
                audioManager.play(SoundMap.CARD_FLIP, 0.8);
            });
            tl.to(cardView.scale, { x: 1, duration: 0.15 });
        });
    }

    private getSuitSymbol(suit: Suit): string {
        switch (suit) {
            case Suit.HEART: return '♥';
            case Suit.DIAMOND: return '♦';
            case Suit.CLUB: return '♣';
            case Suit.SPADE: return '♠';
            default: return '?';
        }
    }
    private getRankString(rank: Rank): string {
        switch (rank) {
            case Rank.RANK_A: return 'A';
            case Rank.RANK_K: return 'K';
            case Rank.RANK_Q: return 'Q';
            case Rank.RANK_J: return 'J';
            case Rank.RANK_10: return '10';
            case Rank.RANK_9: return '9';
            case Rank.RANK_8: return '8';
            case Rank.RANK_7: return '7';
            case Rank.RANK_6: return '6';
            case Rank.RANK_5: return '5';
            case Rank.RANK_4: return '4';
            case Rank.RANK_3: return '3';
            case Rank.RANK_2: return '2';
            default: return '?';
        }
    }

    public dispose(): void {
        this.hideActionCountdown();
        this.cleanupShowdown();
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
            this.unsubscribeStore = null;
        }
    }
}

// Seat view with state
class SeatView extends Container {
    private avatarFrame: Graphics;
    private avatarContainer: Container;
    private avatarPlaceholder: Graphics;
    private emptyIcon: Text;
    private nameText: Text;
    private stackText: Text;
    private statusText: Text;
    private cardBacks: Container;
    private shownCards: Container;
    private lightPoint: Graphics;
    private betTag: Container;
    private betBackground: Graphics;
    private betText: Text;
    private dealerButton: Container;
    private _orbitTween: gsap.core.Tween | null = null;
    private _index: number;
    public userId: bigint = 0n;
    private _currentBet: bigint = 0n;
    private _betTicker = { val: 0 };
    private _currentStack: bigint = -1n;
    private _stackTicker = { val: 0 };

    // Showdown winner state
    private winnerGlow: Graphics | null = null;
    private winAmountBadge: Container | null = null;

    constructor(index: number) {
        super();
        this._index = index;

        this.avatarFrame = new Graphics();
        this.addChild(this.avatarFrame);

        this.avatarContainer = new Container();
        this.addChild(this.avatarContainer);

        this.avatarPlaceholder = new Graphics();
        this.avatarPlaceholder.circle(0, 0, 38); // Increased from 30
        this.avatarPlaceholder.fill({ color: 0x222222 });
        this.avatarPlaceholder.stroke({ color: 0x444444, width: 2.5 });
        this.avatarPlaceholder.circle(0, -8, 14); // Scaled
        this.avatarPlaceholder.fill({ color: 0x444444 });
        this.avatarPlaceholder.ellipse(0, 20, 22, 16); // Scaled
        this.avatarPlaceholder.fill({ color: 0x444444 });
        this.avatarContainer.addChild(this.avatarPlaceholder);

        this.emptyIcon = new Text({
            text: '+',
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 24, fill: 0x333333, fontWeight: '400' }
        });
        this.emptyIcon.anchor.set(0.5);
        this.addChild(this.emptyIcon);

        this.cardBacks = new Container();
        this.cardBacks.y = -65;
        this.cardBacks.visible = false;
        this.addChild(this.cardBacks);

        const cbW = 28;
        const cbH = 40;
        for (let i = 0; i < 2; i++) {
            const container = new Container();
            container.x = (i - 0.5) * 28;

            const backBg = new Graphics();
            backBg.roundRect(-cbW / 2, -cbH / 2, cbW, cbH, 4);
            backBg.fill({ color: 0x050b14 });
            backBg.stroke({ color: COLORS.cyan, width: 1, alpha: 0.4 });

            const pattern = new Graphics();
            pattern.moveTo(-cbW / 4, -cbH / 4).lineTo(cbW / 4, cbH / 4);
            pattern.moveTo(cbW / 4, -cbH / 4).lineTo(-cbW / 4, cbH / 4);
            pattern.stroke({ color: COLORS.cyan, width: 1, alpha: 0.15 });

            container.addChild(backBg, pattern);
            this.cardBacks.addChild(container);
        }

        this.shownCards = new Container();
        this.shownCards.y = -65;
        this.addChild(this.shownCards);

        this.nameText = new Text({
            text: 'EMPTY',
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 13, fontWeight: '700', fill: 0x888888 }, // Increased from 11
        });
        this.nameText.anchor.set(0.5);
        this.nameText.y = 65; // Adjusted from 52
        this.addChild(this.nameText);

        this.stackText = new Text({
            text: '',
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 13, fill: COLORS.cyan }, // Increased from 10
        });
        this.stackText.anchor.set(0.5);
        this.stackText.y = 80; // Adjusted from 66
        this.addChild(this.stackText);

        this.statusText = new Text({
            text: '',
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 13, fontWeight: '700', fill: COLORS.cyan },
        });
        this.statusText.anchor.set(0.5);
        this.statusText.y = 80;
        this.statusText.visible = false;
        this.addChild(this.statusText);

        this.lightPoint = new Graphics();
        this.lightPoint.circle(0, 0, 5);
        this.lightPoint.fill({ color: 0xffffff });
        // Larger, softer glow for the "white halo" effect
        this.lightPoint.circle(0, 0, 12);
        this.lightPoint.fill({ color: 0xffffff, alpha: 0.2 });
        this.lightPoint.circle(0, 0, 20);
        this.lightPoint.fill({ color: 0xffffff, alpha: 0.1 });
        this.lightPoint.visible = false;
        this.addChild(this.lightPoint);

        // 5. Cyber Bet Tag
        this.betTag = new Container();
        this.betTag.visible = false;
        this.addChild(this.betTag);

        this.betBackground = new Graphics();
        // Skewed cyber pill shape
        this.betBackground.moveTo(-35, -12).lineTo(40, -12).lineTo(35, 12).lineTo(-40, 12).closePath();
        this.betBackground.fill({ color: 0x1a0c16, alpha: 0.95 });
        this.betBackground.stroke({ color: COLORS.cyan, width: 1.5, alpha: 0.6 });
        // Add a neon accent line
        this.betBackground.moveTo(-30, 8).lineTo(10, 8);
        this.betBackground.stroke({ color: COLORS.cyan, width: 2, alpha: 0.3 });
        this.betTag.addChild(this.betBackground);

        this.betText = new Text({
            text: '$0',
            style: {
                fontFamily: 'Orbitron, Space Grotesk, Arial',
                fontSize: 15, // Increased from 12
                fill: 0xffffff,
                fontWeight: '900',
                letterSpacing: 1
            }
        });
        this.betText.anchor.set(0.5);
        this.betText.y = -1;
        this.betTag.addChild(this.betText);

        // Dealer Button
        this.dealerButton = new Container();
        const dBtnBg = new Graphics();
        dBtnBg.circle(0, 0, 10);
        dBtnBg.fill({ color: 0xffffff });
        dBtnBg.stroke({ color: 0x000000, width: 1 });
        const dBtnText = new Text({
            text: 'D',
            style: { fontFamily: 'Arial', fontSize: 10, fill: 0x000000, fontWeight: '900' }
        });
        dBtnText.anchor.set(0.5);
        this.dealerButton.addChild(dBtnBg, dBtnText);
        this.dealerButton.x = 32;
        this.dealerButton.y = -32;
        this.dealerButton.visible = false;
        this.addChild(this.dealerButton);

        // Position bet tag towards the center of table
        const offset = 105; // Increased from 85 for larger avatars
        switch (index) {
            case 0: // Bottom Center
                this.betTag.y = -offset;
                break;
            case 1: // Bottom Left
                this.betTag.x = offset;
                this.betTag.y = -offset * 0.4;
                break;
            case 2: // Top Left
                this.betTag.x = offset;
                this.betTag.y = offset * 0.4;
                break;
            case 3: // Top Center
                this.betTag.y = offset;
                break;
            case 4: // Top Right
                this.betTag.x = -offset;
                this.betTag.y = offset * 0.4;
                break;
            case 5: // Bottom Right
                this.betTag.x = -offset;
                this.betTag.y = -offset * 0.4;
                break;
        }

        this.avatarContainer.visible = false;
        this.clear();
    }

    private drawHexagon(g: Graphics, size: number, color: number, alpha: number = 1): void {
        const points: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 2;
            points.push(Math.cos(angle) * size);
            points.push(Math.sin(angle) * size);
        }
        g.poly(points);
        g.fill({ color, alpha });
        g.stroke({ color: 0x444444, width: 3, alpha: 0.8 });
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 2;
            points[i * 2] *= 0.85;
            points[i * 2 + 1] *= 0.85;
        }
        g.poly(points);
        g.stroke({ color: 0xffffff, width: 1, alpha: 0.1 });
    }

    setPlayer(player: PlayerState, isMe: boolean, options?: { instant?: boolean }): void {
        const instant = !!options?.instant;
        this.userId = player.userId;
        this.visible = true;
        this.emptyIcon.visible = false;
        this.avatarContainer.visible = true;
        this.nameText.text = isMe ? 'YOU' : `PLAYER_${player.userId.toString()}`;
        this.nameText.style.fill = isMe ? COLORS.primary : 0xcccccc;

        if (this._currentStack === -1n) {
            // Initial set
            this._currentStack = player.stack;
            this._stackTicker.val = Number(player.stack);
            this.stackText.text = `$${this._stackTicker.val.toLocaleString()}`;
        } else if (this._currentStack !== player.stack) {
            this._currentStack = player.stack;
            if (instant) {
                gsap.killTweensOf(this._stackTicker);
                this._stackTicker.val = Number(player.stack);
                this.stackText.text = `$${Math.floor(this._stackTicker.val).toLocaleString()}`;
            } else {
                gsap.to(this._stackTicker, {
                    val: Number(player.stack),
                    duration: 1.5,
                    ease: 'power2.out',
                    onUpdate: () => {
                        this.stackText.text = `$${Math.floor(this._stackTicker.val).toLocaleString()}`;
                    }
                });
            }
        }

        this.stackText.visible = true;
        this.stackText.alpha = player.folded ? 0.5 : 1.0;

        if (player.folded) {
            this.statusText.text = 'FOLDED';
            this.statusText.style.fill = 0x666666;
            this.statusText.visible = true;
            this.statusText.y = 0;
            this.avatarContainer.alpha = 0.3;
            this.avatarFrame.alpha = 0.4;
            this.cardBacks.visible = false;
        } else {
            this.statusText.visible = false;
            this.statusText.y = 66;
            this.avatarContainer.alpha = 1;
            this.avatarFrame.alpha = 1;
            this.cardBacks.visible = !isMe && player.hasCards && this.shownCards.children.length === 0;
        }

        this.avatarFrame.clear();
        const frameColor = player.folded ? 0x333333 : (isMe ? COLORS.cyan : COLORS.primary);
        this.drawHexagon(this.avatarFrame, 50, 0x0a0609, 1); // Increased from 40
        this.avatarFrame.stroke({ color: frameColor, width: 2, alpha: player.folded ? 0.3 : 0.8 });

        this.setBet(player.bet, options);
    }

    setBet(amount: bigint, options?: { instant?: boolean }): void {
        const instant = !!options?.instant;
        if (amount <= 0n) {
            this.betTag.visible = false;
            this._currentBet = 0n;
            this._betTicker.val = 0;
            return;
        }

        if (!this.betTag.visible) {
            this.betTag.visible = true;
            if (instant) {
                this.betTag.scale.set(1);
            } else {
                this.betTag.scale.set(0);
                gsap.to(this.betTag.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out' });
            }
        }

        if (amount !== this._currentBet) {
            this._currentBet = amount;
            if (instant) {
                gsap.killTweensOf(this._betTicker);
                this._betTicker.val = Number(amount);
                this.betText.text = `$${Math.floor(this._betTicker.val).toLocaleString()}`;
            } else {
                gsap.to(this._betTicker, {
                    val: Number(amount),
                    duration: 0.6,
                    ease: 'power3.out',
                    onUpdate: () => {
                        this.betText.text = `$${Math.floor(this._betTicker.val).toLocaleString()}`;
                    }
                });
            }
        }
    }

    showCards(cards: Card[], animate: boolean = false): void {
        this.cardBacks.visible = false;
        this.shownCards.removeChildren();
        const cardW = 36;
        const cardH = 54;
        const gap = 6;
        cards.forEach((card, i) => {
            const cardW = 36;
            const cardH = 54;
            // Use parent TableScene to create a unified card instance
            const container = (this.parent as any).createCard(card, cardW, cardH, false);
            container.x = (i - 0.5) * (cardW + gap);
            // Tag with card data for later highlight matching
            (container as any)._cardSuit = card.suit;
            (container as any)._cardRank = card.rank;

            // Show front for showdown
            container.getChildByName('back')!.visible = false;
            container.getChildByName('front')!.visible = true;

            this.shownCards.addChild(container);

            if (animate) {
                container.scale.set(0);
                gsap.to(container.scale, { x: 1, y: 1, duration: 0.4, delay: i * 0.1, ease: 'back.out' });
            }
        });
    }

    /**
     * Highlights specific cards in this seat's shownCards that match the given card list.
     * Glow graphics are pushed into outGlowList for centralized cleanup.
     */
    highlightCards(cardsToHighlight: Card[], outGlowList: Graphics[]): void {
        const seatCardW = 36;
        const seatCardH = 54;

        for (const target of cardsToHighlight) {
            for (let i = 0; i < this.shownCards.children.length; i++) {
                const child = this.shownCards.children[i] as any;
                if (child._cardSuit === target.suit && child._cardRank === target.rank) {
                    const glow = new Graphics();
                    glow.roundRect(-seatCardW / 2 - 4, -seatCardH / 2 - 4, seatCardW + 8, seatCardH + 8, 8);
                    glow.fill({ color: COLORS.cyan, alpha: 0.15 });
                    glow.stroke({ color: COLORS.cyan, width: 2, alpha: 0.9 });

                    glow.roundRect(-seatCardW / 2 - 1, -seatCardH / 2 - 1, seatCardW + 2, seatCardH + 2, 6);
                    glow.stroke({ color: 0xffffff, width: 1, alpha: 0.5 });

                    glow.alpha = 0;
                    child.addChild(glow);
                    outGlowList.push(glow);

                    gsap.to(glow, { alpha: 1, duration: 0.4, ease: 'power2.out' });
                    gsap.to(glow, { alpha: 0.6, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.4 });
                    break;
                }
            }
        }
    }

    setActive(isActive: boolean): void {
        if (this._orbitTween) {
            this._orbitTween.kill();
            this._orbitTween = null;
        }

        if (isActive) {
            this.stackText.visible = true;
            this.avatarFrame.clear();
            this.drawHexagon(this.avatarFrame, 50, 0x1a1a1a); // Increased from 40
            this.avatarFrame.stroke({ color: COLORS.cyan, width: 3 });

            this.lightPoint.visible = true;
            const size = 50; // Increased from 40
            const vertices: { x: number, y: number }[] = [];
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i - Math.PI / 2;
                vertices.push({ x: Math.cos(angle) * size, y: Math.sin(angle) * size });
            }
            // Add first vertex again to complete the loop
            vertices.push(vertices[0]);

            const obj = { t: 0 };
            this._orbitTween = gsap.to(obj, {
                t: 6,
                duration: 8, // Significantly slowed down for a calmer, premium feel
                repeat: -1,
                ease: 'none',
                onUpdate: () => {
                    const i = Math.min(Math.floor(obj.t), 5);
                    const f = obj.t - i;
                    const p1 = vertices[i];
                    const p2 = vertices[i + 1];
                    this.lightPoint.x = p1.x + (p2.x - p1.x) * f;
                    this.lightPoint.y = p1.y + (p2.y - p1.y) * f;
                }
            });
        } else {
            this.lightPoint.visible = false;
            // Restore normal frame if not seated/folded handled by setPlayer usually
            // but here we just clear the active state
        }
    }

    clearCards(): void {
        this.cardBacks.visible = false;
        this.shownCards.removeChildren();
    }

    clear(): void {
        this.userId = 0n;
        this.visible = true;
        this.nameText.text = 'EMPTY';
        this.nameText.style.fill = 0x444444;
        this.stackText.text = '';
        this.statusText.visible = false;
        this.cardBacks.visible = false;
        this.shownCards.removeChildren();
        this.avatarContainer.visible = false;
        this.emptyIcon.visible = true;
        this.avatarFrame.clear();
        this.drawHexagon(this.avatarFrame, 50, 0x0a0609, 0.5); // Increased from 40
        this.avatarFrame.stroke({ color: 0x333333, width: 1.5, alpha: 0.4 });
        this.betTag.visible = false;
        this.dealerButton.visible = false;
    }

    setDealer(isDealer: boolean): void {
        this.dealerButton.visible = isDealer;
    }

    private getRankString(rank: Rank): string {
        switch (rank) {
            case 14: return 'A';
            case 13: return 'K';
            case 12: return 'Q';
            case 11: return 'J';
            case 10: return 'T';
            default: return String(rank);
        }
    }

    /**
     * Highlights this seat as a winner with a pulsing golden/cyber glow.
     */
    setWinner(isWinner: boolean): void {
        if (!isWinner) {
            if (this.winnerGlow) {
                gsap.killTweensOf(this.winnerGlow);
                gsap.killTweensOf(this.winnerGlow.scale);
                this.winnerGlow.destroy();
                this.winnerGlow = null;
            }
            return;
        }

        // Create winner glow behind avatar
        const glow = new Graphics();

        // Outer radiant aura
        glow.circle(0, 0, 68);
        glow.fill({ color: COLORS.primary, alpha: 0.12 });
        glow.circle(0, 0, 58);
        glow.fill({ color: COLORS.primary, alpha: 0.2 });

        // Bright inner ring
        const hexPoints: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 2;
            hexPoints.push(Math.cos(angle) * 54);
            hexPoints.push(Math.sin(angle) * 54);
        }
        glow.poly(hexPoints);
        glow.stroke({ color: COLORS.primary, width: 3, alpha: 0.9 });

        // Outer hex ring
        const outerHexPoints: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 2;
            outerHexPoints.push(Math.cos(angle) * 62);
            outerHexPoints.push(Math.sin(angle) * 62);
        }
        glow.poly(outerHexPoints);
        glow.stroke({ color: COLORS.primary, width: 1.5, alpha: 0.4 });

        // Add below avatar but above background
        const avatarIndex = this.getChildIndex(this.avatarFrame);
        this.addChildAt(glow, avatarIndex);
        this.winnerGlow = glow;

        // Animate in with scale + alpha
        glow.scale.set(0.3);
        glow.alpha = 0;
        gsap.to(glow.scale, { x: 1, y: 1, duration: 0.5, ease: 'back.out(1.7)' });
        gsap.to(glow, { alpha: 1, duration: 0.3 });

        // Pulse animation
        gsap.to(glow.scale, {
            x: 1.08, y: 1.08,
            duration: 1.0,
            yoyo: true,
            repeat: -1,
            ease: 'sine.inOut',
            delay: 0.5,
        });
    }

    /**
     * Shows a floating win amount badge (e.g. "+$500") above the seat.
     */
    showWinAmount(amount: bigint): void {
        this.clearWinAmount();

        const badge = new Container();
        badge.y = -110;

        // Background pill
        const bg = new Graphics();
        const text = `+$${Number(amount).toLocaleString()}`;
        const pillW = Math.max(100, text.length * 14 + 30);
        const pillH = 36;
        bg.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, pillH / 2);
        bg.fill({ color: 0x0a1a0a, alpha: 0.9 });
        bg.stroke({ color: 0x00ff88, width: 2, alpha: 0.8 });
        badge.addChild(bg);

        const label = new Text({
            text,
            style: {
                fontFamily: 'Orbitron, Space Grotesk, Inter, sans-serif',
                fontSize: 18,
                fontWeight: '900',
                fill: 0x00ff88,
                dropShadow: { color: 0x00ff88, alpha: 0.5, blur: 8, distance: 0 },
            },
        });
        label.anchor.set(0.5);
        badge.addChild(label);

        this.addChild(badge);
        this.winAmountBadge = badge;

        // Animate: scale in + float up
        badge.scale.set(0);
        badge.alpha = 0;
        const tl = gsap.timeline();
        tl.to(badge.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' });
        tl.to(badge, { alpha: 1, duration: 0.2 }, '<');
        tl.to(badge, { y: badge.y - 15, duration: 2.0, ease: 'power1.out' }, '<0.3');
    }

    /**
     * Removes the win amount badge.
     */
    clearWinAmount(): void {
        if (this.winAmountBadge) {
            gsap.killTweensOf(this.winAmountBadge);
            gsap.killTweensOf(this.winAmountBadge.scale);
            this.winAmountBadge.destroy({ children: true });
            this.winAmountBadge = null;
        }
    }
}
