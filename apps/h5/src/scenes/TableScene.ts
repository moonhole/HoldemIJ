import { Container, Graphics, Text } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameApp } from '../main';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../main';
import { useGameStore } from '../store/gameStore';
import type { TableSnapshot, PlayerState, Card, Pot, ActionPrompt, DealHoleCards, DealBoard, ActionResult, HandStart, SeatUpdate, Showdown, HandEnd, PotUpdate, PhaseChange, WinByFold } from '@gen/messages_pb';
import { ActionType, Suit, Rank, Phase, HandRank } from '@gen/messages_pb';

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
    { x: DESIGN_WIDTH * 0.50, y: 810 },   // [0] Bottom Center (Hero spot)
    { x: DESIGN_WIDTH * 0.15, y: 680 },   // [1] Bottom Left
    { x: DESIGN_WIDTH * 0.15, y: 340 },   // [2] Top Left
    { x: DESIGN_WIDTH * 0.50, y: 220 },   // [3] Top Center (Opposite)
    { x: DESIGN_WIDTH * 0.85, y: 340 },   // [4] Top Right
    { x: DESIGN_WIDTH * 0.85, y: 680 },   // [5] Bottom Right
];

export class TableScene extends Container {
    private _game: GameApp;
    private potText!: Text;
    private potAmount!: Text;
    private communityCards!: Container;
    private seatViews: SeatView[] = [];
    private myCards!: Container;
    private actionPanel!: Container;
    private myChair: number = -1;
    private boardCards: Card[] = [];
    private unsubscribeStore: (() => void) | null = null;
    private _potTickerValue = { val: 0 };

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
        const tabletopY = 120; // Corrected to avoid top card clipping
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
    }

    private createPotDisplay(): void {
        const potContainer = new Container();
        potContainer.x = DESIGN_WIDTH / 2;
        potContainer.y = 380; // Moved down to avoid clash with top player
        this.addChild(potContainer);

        this.potText = new Text({
            text: 'TOTAL POT',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 10,
                letterSpacing: 4,
                fill: 0x666666,
                fontWeight: '700',
            },
        });
        this.potText.anchor.set(0.5);
        this.potText.y = -35;
        potContainer.addChild(this.potText);

        const potValueContainer = new Container();
        potValueContainer.y = 10;
        potContainer.addChild(potValueContainer);

        const currencySymbol = new Text({
            text: '$',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 34,
                fontWeight: '900',
                fontStyle: 'italic',
                fill: COLORS.primary,
            },
        });
        currencySymbol.anchor.set(1, 0.5);
        currencySymbol.x = -8;
        potValueContainer.addChild(currencySymbol);

        this.potAmount = new Text({
            text: '0',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 54,
                fontWeight: '900',
                fontStyle: 'italic',
                fill: 0xffffff,
                letterSpacing: 2,
            },
        });
        this.potAmount.anchor.set(0, 0.5);
        potValueContainer.addChild(this.potAmount);
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
        this.communityCards.y = 530; // Moved down to accommodate pot display change
        this.addChild(this.communityCards);
    }

    private createActionPanel(): void {
        this.actionPanel = new Container();
        // actionPanel matches the taller console height
        this.actionPanel.y = DESIGN_HEIGHT - 680;
        this.addChild(this.actionPanel);

        // myCards will sit "on top" of the console
        this.myCards = new Container();
        this.myCards.x = DESIGN_WIDTH / 2;
        this.myCards.y = 100; // Moved up from 180 to avoid UI overlay blocking
        this.actionPanel.addChild(this.myCards);
    }

    private setupHandlers(): void {
        this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
            this.myChair = state.myChair;
            if (state.streamSeq === prev.streamSeq || !state.lastEvent) return;
            const event = state.lastEvent;
            switch (event.type) {
                case 'snapshot': this.handleSnapshot(event.value); break;
                case 'handStart': this.handleHandStart(event.value); break;
                case 'holeCards': this.handleHoleCards(event.value); break;
                case 'board': this.handleBoard(event.value); break;
                case 'potUpdate': this.handlePotUpdate(event.value); break;
                case 'phaseChange': this.handlePhaseChange(event.value); break;
                case 'actionPrompt': this.handleActionPrompt(event.value); break;
                case 'actionResult':
                    this.handleActionResult(event.value);
                    this.updatePot(event.value.newPotTotal);
                    break;
                case 'handEnd': this.handleHandEnd(event.value); break;
                case 'seatUpdate': this.handleSeatUpdate(event.value); break;
                case 'showdown': this.handleShowdown(event.value); break;
                case 'winByFold': this.handleWinByFold(event.value); break;
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
        const totalPot = snap.pots.reduce((acc, p) => acc + p.amount, 0n);
        this._potTickerValue.val = Number(totalPot); // Set initial value without animation
        this.updatePotFromPots(snap.pots);
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

    private updateSeats(): void {
        const players = this.getPlayers();
        for (let chair = 0; chair < 6; chair++) {
            let viewIndex = (this.myChair !== -1) ? (chair - this.myChair + 6) % 6 : chair % 6;
            const view = this.seatViews[viewIndex];
            const player = players.find(p => p.chair === chair);

            if (player) {
                view.setPlayer(player, chair === this.myChair);
            } else {
                view.clear();
            }
        }
    }

    private updateActivePlayer(actionChair: number): void {
        this.seatViews.forEach(sv => sv.setActive(false));
        if (actionChair === -1) return;

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

    private handleHandStart(start: HandStart): void {
        this.myCards.removeChildren();
        this.communityCards.removeChildren();
        this.boardCards = [];
        this.updatePot(0n);

        for (const sv of this.seatViews) sv.clearCards();

        // Update seats to show blinds (already updated in gameStore)
        this.updateSeats();

        // Update dealer buttons
        for (let chair = 0; chair < 6; chair++) {
            let viewIndex = (this.myChair !== -1) ? (chair - this.myChair + 6) % 6 : chair % 6;
            const view = this.seatViews[viewIndex];
            view.setDealer(chair === start.dealerChair);
        }

        this.updateActivePlayer(-1);
    }

    private handleHoleCards(deal: DealHoleCards): void {
        this.showMyCards(deal.cards);
        this.updateSeats();
    }

    private handleBoard(board: DealBoard): void {
        if (board.phase === Phase.FLOP) {
            this.boardCards = [...board.cards];
        } else {
            this.boardCards = [...this.boardCards, ...board.cards];
            if (board.phase === Phase.TURN) this.boardCards = this.boardCards.slice(0, 4);
            else if (board.phase === Phase.RIVER) this.boardCards = this.boardCards.slice(0, 5);
        }
        this.updateCommunityCards(this.boardCards);
    }

    private handlePotUpdate(update: PotUpdate): void {
        this.updatePotFromPots(update.pots);
    }

    private handlePhaseChange(phaseChange: PhaseChange): void {
        this.boardCards = [...phaseChange.communityCards];
        this.updateCommunityCards(this.boardCards);
        this.updatePotFromPots(phaseChange.pots);
        this.updateSeats();
    }

    private handleActionResult(result: ActionResult): void {
        if (result.action === ActionType.ACTION_FOLD && result.chair === this.myChair) {
            this.myCards.removeChildren();
        }
        this.updateSeats();
    }

    private handleActionPrompt(prompt: ActionPrompt): void {
        if (this.myChair === -1) {
            const storeChair = useGameStore.getState().myChair;
            this.myChair = storeChair !== -1 ? storeChair : prompt.chair;
            this.updateSeats();
        }
        this.updateActivePlayer(prompt.chair);
    }

    private handleShowdown(showdown: Showdown): void {
        for (const hand of showdown.hands) {
            if (hand.chair !== this.myChair) {
                let viewIndex = -1;
                if (this.myChair !== -1) {
                    viewIndex = (hand.chair - this.myChair + 6) % 6;
                } else {
                    viewIndex = hand.chair % 6;
                }
                if (viewIndex >= 0 && viewIndex < this.seatViews.length) {
                    this.seatViews[viewIndex].showCards(hand.holeCards);
                }
            }
        }
    }

    private handleHandEnd(end: HandEnd): void {
        this.updateActivePlayer(-1);
        this.updateSeats();
        this.updatePot(0n); // Animate pot down to zero as chips flow to winners
    }

    private handleWinByFold(winByFold: WinByFold): void {
        this.updateActivePlayer(-1);
        // We'll let handleHandEnd (which follows) handle the definitive stack updates
        // Just animate the pot clearing for visual feedback
        this.updatePot(0n);
    }

    private updatePotFromPots(pots: Pot[]): void {
        let potTotal = 0n;
        for (const pot of pots) potTotal += pot.amount;
        this.updatePot(potTotal);
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

    private updatePot(amount: bigint): void {
        const target = Number(amount);
        gsap.to(this._potTickerValue, {
            val: target,
            duration: 1.2,
            ease: 'power4.out',
            onUpdate: () => {
                this.potAmount.text = Math.floor(this._potTickerValue.val).toLocaleString();
            }
        });
    }

    private showMyCards(cards: Card[]): void {
        this.myCards.removeChildren();
        const cardW = 100;
        const cardH = 145;
        const gap = 16;
        const totalWidth = cards.length * cardW + (cards.length - 1) * gap;
        const startX = -totalWidth / 2;

        cards.forEach((card, i) => {
            const cardView = this.createHeroCard(card, cardW, cardH);
            cardView.x = startX + i * (cardW + gap) + cardW / 2;
            cardView.y = 0;
            cardView.rotation = (i - 0.5) * 0.12;
            cardView.scale.set(0);
            this.myCards.addChild(cardView);
            // Animate scale to 1.2 for better fit
            gsap.to(cardView.scale, { x: 1.2, y: 1.2, duration: 0.5, delay: i * 0.15, ease: 'back.out' });
        });
    }

    private createHeroCard(card: Card, width: number, height: number): Container {
        const container = new Container();
        const glow = new Graphics();
        glow.roundRect(-width / 2 - 8, -height / 2 - 8, width + 16, height + 16, 18);
        glow.fill({ color: COLORS.primary, alpha: 0.4 });
        container.addChild(glow);

        const bg = new Graphics();
        bg.roundRect(-width / 2, -height / 2, width, height, 15);
        bg.fill({ color: 0x050205 });
        bg.stroke({ color: COLORS.primary, width: 3, alpha: 0.8 });
        container.addChild(bg);

        const highlight = new Graphics();
        highlight.roundRect(-width / 2, -height / 2, width, height / 2.5, 15);
        highlight.fill({ color: COLORS.primary, alpha: 0.15 });
        container.addChild(highlight);

        const isRed = card.suit === Suit.HEART || card.suit === Suit.DIAMOND;
        const color = isRed ? COLORS.cardRed : 0xffffff;

        const rankText = new Text({
            text: this.getRankString(card.rank),
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 40, fontWeight: '900', fill: color },
        });
        rankText.anchor.set(0.5);
        rankText.y = -20;
        container.addChild(rankText);

        const suitText = new Text({
            text: this.getSuitSymbol(card.suit),
            style: { fontFamily: 'Inter, sans-serif', fontSize: 48, fill: color },
        });
        suitText.anchor.set(0.5);
        suitText.y = 35;
        container.addChild(suitText);
        return container;
    }

    private updateCommunityCards(cards: Card[]): void {
        this.communityCards.removeChildren();
        const cardW = 55;
        const cardH = 85;
        const gap = 8;
        const totalCards = 5;
        const totalWidth = totalCards * cardW + (totalCards - 1) * gap;
        const startX = -totalWidth / 2;

        for (let i = 0; i < totalCards; i++) {
            if (i < cards.length) {
                const cardView = this.createCommunityCard(cards[i], cardW, cardH);
                cardView.x = startX + i * (cardW + gap) + cardW / 2;
                this.communityCards.addChild(cardView);
            } else {
                const placeholder = new Graphics();
                placeholder.roundRect(startX + i * (cardW + gap), -cardH / 2, cardW, cardH, 8);
                placeholder.fill({ color: 0x000000, alpha: 0.3 });
                placeholder.stroke({ color: 0x333333, width: 1, alpha: 0.5 });
                this.communityCards.addChild(placeholder);
            }
        }
    }

    private createCommunityCard(card: Card, width: number, height: number): Container {
        const container = new Container();
        const bg = new Graphics();
        bg.roundRect(-width / 2, -height / 2, width, height, 10);
        bg.fill({ color: 0x120810 });
        bg.stroke({ color: 0x333333, width: 1.5 });
        container.addChild(bg);

        const isRed = card.suit === Suit.HEART || card.suit === Suit.DIAMOND;
        const color = isRed ? COLORS.cardRed : 0xdddddd;

        const rankText = new Text({
            text: this.getRankString(card.rank),
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 24, fontWeight: '800', fill: color },
        });
        rankText.anchor.set(0.5);
        rankText.y = -15;
        container.addChild(rankText);

        const suitText = new Text({
            text: this.getSuitSymbol(card.suit),
            style: { fontFamily: 'Inter, sans-serif', fontSize: 28, fill: color },
        });
        suitText.anchor.set(0.5);
        suitText.y = 18;
        container.addChild(suitText);
        return container;
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

    private getSuitSymbol(suit: Suit): string {
        switch (suit) {
            case Suit.SPADE: return '\u2660';
            case Suit.HEART: return '\u2665';
            case Suit.CLUB: return '\u2663';
            case Suit.DIAMOND: return '\u2666';
            default: return '?';
        }
    }

    public dispose(): void {
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
    public userId: number = -1;
    private _currentBet: bigint = 0n;
    private _betTicker = { val: 0 };
    private _currentStack: bigint = -1n;
    private _stackTicker = { val: 0 };

    constructor(index: number) {
        super();
        this._index = index;

        this.avatarFrame = new Graphics();
        this.addChild(this.avatarFrame);

        this.avatarContainer = new Container();
        this.addChild(this.avatarContainer);

        this.avatarPlaceholder = new Graphics();
        this.avatarPlaceholder.circle(0, 0, 30);
        this.avatarPlaceholder.fill({ color: 0x222222 });
        this.avatarPlaceholder.stroke({ color: 0x444444, width: 2.5 });
        this.avatarPlaceholder.circle(0, -6, 11);
        this.avatarPlaceholder.fill({ color: 0x444444 });
        this.avatarPlaceholder.ellipse(0, 16, 18, 12);
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

        for (let i = 0; i < 2; i++) {
            const cardBack = new Graphics();
            cardBack.roundRect((i - 1) * 24 + 2, -20, 28, 40, 4);
            cardBack.fill({ color: 0x1e40af });
            cardBack.stroke({ color: 0x3b82f6, width: 1.5 });
            this.cardBacks.addChild(cardBack);
        }

        this.shownCards = new Container();
        this.shownCards.y = -65;
        this.addChild(this.shownCards);

        this.nameText = new Text({
            text: 'EMPTY',
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 11, fontWeight: '700', fill: 0x888888 },
        });
        this.nameText.anchor.set(0.5);
        this.nameText.y = 52;
        this.addChild(this.nameText);

        this.stackText = new Text({
            text: '',
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 10, fill: COLORS.cyan },
        });
        this.stackText.anchor.set(0.5);
        this.stackText.y = 66;
        this.addChild(this.stackText);

        this.statusText = new Text({
            text: '',
            style: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 10, fontWeight: '700', fill: COLORS.cyan },
        });
        this.statusText.anchor.set(0.5);
        this.statusText.y = 66;
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
                fontSize: 12,
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
        const offset = 85;
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

    setPlayer(player: PlayerState, isMe: boolean): void {
        this.userId = player.userId;
        this.visible = true;
        this.emptyIcon.visible = false;
        this.avatarContainer.visible = true;
        this.nameText.text = isMe ? 'YOU' : `PLAYER_${player.userId}`;
        this.nameText.style.fill = isMe ? COLORS.primary : 0xcccccc;

        if (this._currentStack === -1n) {
            // Initial set
            this._currentStack = player.stack;
            this._stackTicker.val = Number(player.stack);
            this.stackText.text = `$${this._stackTicker.val.toLocaleString()}`;
        } else if (this._currentStack !== player.stack) {
            this._currentStack = player.stack;
            gsap.to(this._stackTicker, {
                val: Number(player.stack),
                duration: 1.5,
                ease: 'power2.out',
                onUpdate: () => {
                    this.stackText.text = `$${Math.floor(this._stackTicker.val).toLocaleString()}`;
                }
            });
        }

        this.stackText.visible = !player.folded;

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
            this.cardBacks.visible = !isMe && this.shownCards.children.length === 0;
        }

        this.avatarFrame.clear();
        const frameColor = player.folded ? 0x333333 : (isMe ? COLORS.cyan : COLORS.primary);
        this.drawHexagon(this.avatarFrame, 40, 0x0a0609, 1);
        this.avatarFrame.stroke({ color: frameColor, width: 2, alpha: player.folded ? 0.3 : 0.8 });

        this.setBet(player.bet);
    }

    setBet(amount: bigint): void {
        if (amount <= 0n) {
            this.betTag.visible = false;
            this._currentBet = 0n;
            this._betTicker.val = 0;
            return;
        }

        if (!this.betTag.visible) {
            this.betTag.visible = true;
            this.betTag.scale.set(0);
            gsap.to(this.betTag.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out' });
        }

        if (amount !== this._currentBet) {
            this._currentBet = amount;
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

    showCards(cards: Card[]): void {
        this.cardBacks.visible = false;
        this.shownCards.removeChildren();
        const cardW = 36;
        const cardH = 54;
        const gap = 6;
        cards.forEach((card, i) => {
            const container = new Container();
            container.x = (i - 0.5) * (cardW + gap);
            const bg = new Graphics();
            bg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 5);
            bg.fill({ color: 0x1a1a1a });
            bg.stroke({ color: 0x888888, width: 1 });
            container.addChild(bg);
            const isRed = card.suit === Suit.HEART || card.suit === Suit.DIAMOND;
            const color = isRed ? 0xff4444 : 0xcccccc;
            const text = new Text({ text: this.getRankString(card.rank), style: { fontFamily: 'Arial', fontSize: 16, fill: color, fontWeight: 'bold' } });
            text.anchor.set(0.5);
            container.addChild(text);
            this.shownCards.addChild(container);
        });
    }

    setActive(isActive: boolean): void {
        if (this._orbitTween) {
            this._orbitTween.kill();
            this._orbitTween = null;
        }

        if (isActive) {
            this.statusText.text = 'THINKING...';
            this.statusText.style.fill = COLORS.cyan;
            this.statusText.visible = true;
            this.statusText.y = 86; // Lowered to avoid overlap with stack at 66
            this.stackText.visible = true;
            this.avatarFrame.clear();
            this.drawHexagon(this.avatarFrame, 40, 0x1a1a1a);
            this.avatarFrame.stroke({ color: COLORS.cyan, width: 3 });

            this.lightPoint.visible = true;
            const size = 40;
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
        this.userId = -1;
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
        this.drawHexagon(this.avatarFrame, 40, 0x0a0609, 0.5);
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
}
