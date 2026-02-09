import { Container, Graphics, Text } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameApp } from '../main';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../main';
import { useGameStore } from '../store/gameStore';
import type { TableSnapshot, PlayerState, Card, Pot, ActionPrompt, DealHoleCards, DealBoard, ActionResult, HandStart, SeatUpdate, Showdown, HandEnd, PotUpdate, PhaseChange, WinByFold } from '@gen/messages_pb';
import { ActionType, Suit, Rank, Phase, HandRank } from '@gen/messages_pb';

// Colors from cyber-poker design
const COLORS = {
    primary: 0xf425af,      // Pink/Magenta
    cyan: 0x00f3ff,         // Cyber cyan
    bgDark: 0x0a0609,       // Dark background
    bgPanel: 0x1a0c16,      // Panel background
    white10: 0x1a1a1a,
    white20: 0x333333,
    cardRed: 0xf425af,      // Pink for hearts/diamonds
    cardBlack: 0xffffff,    // White for spades/clubs
};

// Opponent positions (top area, 2x2 grid style)
const OPPONENT_POSITIONS = [
    { x: DESIGN_WIDTH * 0.25, y: 180 },   // Top left
    { x: DESIGN_WIDTH * 0.75, y: 180 },   // Top right
    { x: DESIGN_WIDTH * 0.25, y: 320 },   // Mid left
    { x: DESIGN_WIDTH * 0.75, y: 320 },   // Mid right
];

export class TableScene extends Container {
    private _game: GameApp;
    private potText!: Text;
    private potAmount!: Text;
    private communityCards!: Container;
    private opponentViews: OpponentView[] = [];
    private myCards!: Container;
    private actionPanel!: Container;
    private stackText!: Text;
    private myChair: number = -1;
    private boardCards: Card[] = [];
    private unsubscribeStore: (() => void) | null = null;

    // Local state to track all players at the table
    // Maps chair ID -> PlayerState
    private players = new Map<number, PlayerState>();

    constructor(game: GameApp) {
        super();
        this._game = game;

        // Background gradient
        const bg = new Graphics();
        bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        bg.fill({ color: COLORS.bgDark });
        this.addChild(bg);

        // Top status bar
        this.createTopBar();

        // Pot display
        this.createPotDisplay();

        // Opponent grid (4 opponents visible)
        this.createOpponentGrid();

        // Community cards
        this.createCommunityCards();

        // Bottom action panel with hole cards
        this.createActionPanel();

        this.myChair = useGameStore.getState().myChair;

        // Store -> Pixi bridge
        this.setupHandlers();

        // Apply latest store state
        this.applyCachedState();
    }

    private createTopBar(): void {
        const topBar = new Container();
        topBar.y = 40;
        this.addChild(topBar);

        // Signal indicator
        const signal = new Text({
            text: '▰▰▰▰',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 10,
                fill: COLORS.cyan,
            },
        });
        signal.x = 30;
        topBar.addChild(signal);

        // Table name
        const tableName = new Text({
            text: 'TABLE_402_CORE',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 10,
                letterSpacing: 3,
                fill: 0x666666,
            },
        });
        tableName.x = 60;
        topBar.addChild(tableName);

        // Settings button
        const settingsBtn = new Graphics();
        settingsBtn.circle(DESIGN_WIDTH - 80, 0, 16);
        settingsBtn.fill({ color: 0x331122 });
        settingsBtn.stroke({ color: COLORS.primary, width: 1, alpha: 0.3 });
        topBar.addChild(settingsBtn);

        // Chat button
        const chatBtn = new Graphics();
        chatBtn.circle(DESIGN_WIDTH - 40, 0, 16);
        chatBtn.fill({ color: 0x003333 });
        chatBtn.stroke({ color: COLORS.cyan, width: 1, alpha: 0.3 });
        topBar.addChild(chatBtn);
    }

    private createPotDisplay(): void {
        const potContainer = new Container();
        potContainer.x = DESIGN_WIDTH / 2;
        potContainer.y = 90;
        this.addChild(potContainer);

        // "TOTAL POT" label
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
        this.potText.y = -20;
        potContainer.addChild(this.potText);

        // Pot amount with glow effect
        this.potAmount = new Text({
            text: '$0',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 36,
                fontWeight: '700',
                fontStyle: 'italic',
                fill: 0xffffff,
            },
        });
        this.potAmount.anchor.set(0.5);
        potContainer.addChild(this.potAmount);
    }

    private createOpponentGrid(): void {
        // Create 4 opponent views in a 2x2 grid
        for (let i = 0; i < 4; i++) {
            const pos = OPPONENT_POSITIONS[i];
            const opponent = new OpponentView(i);
            opponent.x = pos.x;
            opponent.y = pos.y;
            this.addChild(opponent);
            this.opponentViews.push(opponent);
        }
    }

    private createCommunityCards(): void {
        this.communityCards = new Container();
        this.communityCards.x = DESIGN_WIDTH / 2;
        this.communityCards.y = 450;
        this.addChild(this.communityCards);
    }

    private createActionPanel(): void {
        // Bottom action panel
        this.actionPanel = new Container();
        this.actionPanel.y = DESIGN_HEIGHT - 380;
        this.addChild(this.actionPanel);

        // Panel background with rounded top
        const panelBg = new Graphics();
        panelBg.roundRect(0, 0, DESIGN_WIDTH, 380, 40);
        panelBg.fill({ color: COLORS.bgPanel });
        panelBg.stroke({ color: COLORS.primary, width: 1, alpha: 0.2 });
        this.actionPanel.addChild(panelBg);

        // My hole cards (positioned above panel)
        this.myCards = new Container();
        this.myCards.x = DESIGN_WIDTH / 2;
        this.myCards.y = -40;
        this.actionPanel.addChild(this.myCards);

        // Action HUD content
        const hudContent = new Container();
        hudContent.x = 30;
        hudContent.y = 100;
        this.actionPanel.addChild(hudContent);

        // Your Stack
        const stackLabel = new Text({
            text: 'YOUR STACK',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 10,
                letterSpacing: 3,
                fill: 0x666666,
                fontWeight: '700',
            },
        });
        hudContent.addChild(stackLabel);

        this.stackText = new Text({
            text: '$10,000',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 24,
                fontWeight: '700',
                fill: 0xffffff,
            },
        });
        this.stackText.y = 15;
        hudContent.addChild(this.stackText);

    }

    private setupHandlers(): void {
        this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
            this.myChair = state.myChair;
            if (state.streamSeq === prev.streamSeq || !state.lastEvent) {
                return;
            }
            const event = state.lastEvent;
            switch (event.type) {
                case 'snapshot':
                    this.handleSnapshot(event.value);
                    break;
                case 'handStart':
                    this.handleHandStart(event.value);
                    break;
                case 'holeCards':
                    this.handleHoleCards(event.value);
                    break;
                case 'board':
                    this.handleBoard(event.value);
                    break;
                case 'potUpdate':
                    this.handlePotUpdate(event.value);
                    break;
                case 'phaseChange':
                    this.handlePhaseChange(event.value);
                    break;
                case 'actionPrompt':
                    this.handleActionPrompt(event.value);
                    break;
                case 'actionResult':
                    console.log('[TableScene] Action result:', event.value);
                    this.handleActionResult(event.value);
                    this.updatePot(event.value.newPotTotal);
                    break;
                case 'handEnd':
                    this.handleHandEnd(event.value);
                    break;
                case 'seatUpdate':
                    this.handleSeatUpdate(event.value);
                    break;
                case 'showdown':
                    this.handleShowdown(event.value);
                    break;
                case 'winByFold':
                    this.handleWinByFold(event.value);
                    break;
                case 'error':
                    console.error('[TableScene] Error:', event.code, event.message);
                    break;
                case 'connect':
                case 'disconnect':
                    break;
            }
        });
    }

    private applyCachedState(): void {
        const state = useGameStore.getState();
        this.myChair = state.myChair;
        if (state.snapshot) {
            this.handleSnapshot(state.snapshot);
        }
        if (state.handStart) {
            this.handleHandStart(state.handStart);
        }
        if (state.holeCards) {
            this.handleHoleCards(state.holeCards);
        }
        if (state.actionPrompt) {
            this.handleActionPrompt(state.actionPrompt);
        }
        if (state.phaseChange) {
            this.handlePhaseChange(state.phaseChange);
        }
        if (state.potUpdate) {
            this.handlePotUpdate(state.potUpdate);
        }
    }

    private handleSnapshot(snap: TableSnapshot): void {
        console.log('[TableScene] Snapshot:', snap);

        // Clear and populate players map
        this.players.clear();
        for (const player of snap.players) {
            this.players.set(player.chair, player);
        }

        // Find my chair
        if (this.myChair !== -1) {
            const myPlayer = this.players.get(this.myChair);
            if (!myPlayer) {
                console.warn('[TableScene] My chair not found in snapshot players');
            }
        } else {
            const storeChair = useGameStore.getState().myChair;
            if (storeChair !== -1) {
                this.myChair = storeChair;
            }
        }

        // Update pot
        this.updatePotFromPots(snap.pots);

        // Update seats logic
        this.updateSeats();

        // Update community cards
        this.boardCards = [...snap.communityCards];
        this.updateCommunityCards(this.boardCards);

        // Active player highlight
        this.updateActivePlayer(snap.actionChair);
    }

    private handleSeatUpdate(update: SeatUpdate): void {
        console.log('[TableScene] Seat update:', update);

        const chair = update.chair;

        switch (update.update.case) {
            case 'playerJoined':
                const player = update.update.value;
                this.players.set(chair, player);
                if (chair === useGameStore.getState().myChair) {
                    this.myChair = chair;
                }
                break;

            case 'playerLeftUserId':
                this.players.delete(chair);
                // Clear any view showing this chair
                this.updateSeats();
                break;

            case 'stackChange':
                // Update stack in map
                const pStack = this.players.get(chair);
                if (pStack) {
                    pStack.stack = update.update.value;
                }
                break;
        }

        this.updateSeats();
    }

    // Core function to map players to views
    private updateSeats(): void {
        // Clear all opponent views first
        for (const ov of this.opponentViews) {
            ov.clear();
        }

        // Iterate through all players
        for (const [chair, player] of this.players) {
            if (chair === this.myChair) {
                // My update
                this.stackText.text = `$${player.stack}`;
                if (player.handCards.length > 0) {
                    this.showMyCards(player.handCards);
                }
            } else {
                // Opponent
                let viewIndex = -1;

                if (this.myChair !== -1) {
                    // Calculate relative index: 1-5
                    const relative = (chair - this.myChair + 6) % 6;
                    // Limit to first 4 right-hand opponents (indices 1,2,3,4)
                    if (relative >= 1 && relative <= 4) {
                        viewIndex = relative - 1;
                    }
                } else {
                    // Just fill by chair ID mapping to 0..3
                    if (chair < 4) viewIndex = chair;
                }

                if (viewIndex >= 0 && viewIndex < this.opponentViews.length) {
                    this.opponentViews[viewIndex].setPlayer(player);
                }
            }
        }
    }

    private updateActivePlayer(actionChair: number): void {
        this.opponentViews.forEach(ov => ov.setActive(false));

        const activePlayer = this.players.get(actionChair);
        if (activePlayer && activePlayer.chair !== this.myChair) {
            for (const ov of this.opponentViews) {
                if (ov.userId === activePlayer.userId) {
                    ov.setActive(true);
                }
            }
        }
    }

    private handleHandStart(start: HandStart): void {
        console.log('[TableScene] Hand started:', start);
        this.myCards.removeChildren();
        this.communityCards.removeChildren();
        this.boardCards = [];
        this.updatePot(0n);

        // Reset per-hand player state so updateSeats() can immediately render opponent backs.
        for (const player of this.players.values()) {
            player.bet = 0n;
            player.folded = false;
            player.allIn = false;
            player.lastAction = ActionType.ACTION_UNSPECIFIED;
            player.handCards = [];
        }

        // Clear opponent cards
        for (const ov of this.opponentViews) {
            ov.clearCards();
        }

        // Re-render seat state right away so opponents show card backs before first action.
        this.updateSeats();
        this.updateActivePlayer(-1);
    }

    private handleHoleCards(deal: DealHoleCards): void {
        console.log('[TableScene] Hole cards:', deal.cards);
        this.showMyCards(deal.cards);

        // Also update my cards in player state
        if (this.myChair !== -1) {
            const me = this.players.get(this.myChair);
            if (me) {
                me.handCards = deal.cards;
            }
        }
    }

    private handleBoard(board: DealBoard): void {
        console.log('[TableScene] Board dealt:', board.phase, board.cards);
        if (board.phase === Phase.FLOP) {
            this.boardCards = [...board.cards];
        } else {
            this.boardCards = [...this.boardCards, ...board.cards];
            if (board.phase === Phase.TURN) {
                this.boardCards = this.boardCards.slice(0, 4);
            } else if (board.phase === Phase.RIVER) {
                this.boardCards = this.boardCards.slice(0, 5);
            }
        }
        this.updateCommunityCards(this.boardCards);
    }

    private handlePotUpdate(update: PotUpdate): void {
        console.log('[TableScene] Pot update:', update);
        this.updatePotFromPots(update.pots);
    }

    private handlePhaseChange(phaseChange: PhaseChange): void {
        console.log('[TableScene] Phase change:', phaseChange.phase, phaseChange);
        this.boardCards = [...phaseChange.communityCards];
        this.updateCommunityCards(this.boardCards);
        this.updatePotFromPots(phaseChange.pots);

        if (phaseChange.myHandRank !== undefined) {
            const handLabel = this.getHandRankLabel(phaseChange.myHandRank);
            const handValue = phaseChange.myHandValue !== undefined ? ` value=${phaseChange.myHandValue}` : '';
            console.log(`[TableScene] My hand: ${handLabel}${handValue}`);
        }
    }

    private handleActionResult(result: ActionResult): void {
        const player = this.players.get(result.chair);
        if (!player) {
            return;
        }
        player.stack = result.newStack;
        player.lastAction = result.action;
        if (result.action === ActionType.ACTION_FOLD) {
            player.folded = true;
        }
        if (result.action === ActionType.ACTION_ALLIN) {
            player.allIn = true;
        }
        this.updateSeats();
    }

    private handleActionPrompt(prompt: ActionPrompt): void {
        console.log('[TableScene] Action prompt:', prompt);

        if (this.myChair === -1) {
            const storeChair = useGameStore.getState().myChair;
            this.myChair = storeChair !== -1 ? storeChair : prompt.chair;
            // re-update seats now that we know who we are
            this.updateSeats();
        }

        this.updateActivePlayer(prompt.chair);
    }

    private handleShowdown(showdown: Showdown): void {
        console.log('[TableScene] Showdown:', showdown);

        // Show opponent cards
        for (const hand of showdown.hands) {
            if (hand.chair !== this.myChair) {
                // Find view for chair
                let viewIndex = -1;
                if (this.myChair !== -1) {
                    const relative = (hand.chair - this.myChair + 6) % 6;
                    if (relative >= 1 && relative <= 4) viewIndex = relative - 1;
                } else {
                    if (hand.chair < 4) viewIndex = hand.chair;
                }

                if (viewIndex >= 0 && viewIndex < this.opponentViews.length) {
                    this.opponentViews[viewIndex].showCards(hand.holeCards);
                }
            }
        }

        // Log winners (UI animation could be added here)
        for (const pr of showdown.potResults) {
            for (const winner of pr.winners) {
                console.log(`[TableScene] Pot Winner: Chair ${winner.chair} wins ${winner.winAmount}`);
            }
        }

        if (showdown.excessRefund) {
            console.log(`[TableScene] Excess refund: Chair ${showdown.excessRefund.chair} +${showdown.excessRefund.amount}`);
        }
        for (const net of showdown.netResults) {
            if (net.isWinner || net.winAmount !== 0n) {
                console.log(`[TableScene] Net result: chair=${net.chair} win=${net.winAmount} winner=${net.isWinner}`);
            }
        }
    }

    private handleHandEnd(end: HandEnd): void {
        console.log('[TableScene] Hand ended:', end);
        this.updateActivePlayer(-1);

        for (const stackDelta of end.stackDeltas) {
            const player = this.players.get(stackDelta.chair);
            if (!player) {
                continue;
            }
            player.stack = stackDelta.newStack;
            player.bet = 0n;
            player.folded = false;
            player.allIn = false;
            player.lastAction = ActionType.ACTION_UNSPECIFIED;
        }
        this.updateSeats();

        if (end.excessRefund) {
            console.log(`[TableScene] HandEnd excess refund: Chair ${end.excessRefund.chair} +${end.excessRefund.amount}`);
        }
        for (const net of end.netResults) {
            if (net.isWinner || net.winAmount !== 0n) {
                console.log(`[TableScene] HandEnd net: chair=${net.chair} win=${net.winAmount} winner=${net.isWinner}`);
            }
        }
    }

    private handleWinByFold(winByFold: WinByFold): void {
        console.log('[TableScene] Win by fold:', winByFold);
        this.updateActivePlayer(-1);
        this.updatePot(winByFold.potTotal);
    }

    private updatePotFromPots(pots: Pot[]): void {
        let potTotal = 0n;
        for (const pot of pots) {
            potTotal += pot.amount;
        }
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
        this.potAmount.text = `$${amount.toLocaleString()}`;
    }

    private showMyCards(cards: Card[]): void {
        this.myCards.removeChildren();

        const cardW = 90;
        const cardH = 130;
        const gap = 20;
        const totalWidth = cards.length * cardW + (cards.length - 1) * gap;
        const startX = -totalWidth / 2;

        cards.forEach((card, i) => {
            const cardView = this.createHeroCard(card, cardW, cardH);
            cardView.x = startX + i * (cardW + gap) + cardW / 2;
            cardView.y = 0;
            cardView.rotation = (i - 0.5) * 0.05; // Slight tilt
            cardView.scale.set(0);
            this.myCards.addChild(cardView);

            gsap.to(cardView.scale, {
                x: 1,
                y: 1,
                duration: 0.4,
                delay: i * 0.1,
                ease: 'back.out',
            });
        });
    }

    private createHeroCard(card: Card, width: number, height: number): Container {
        const container = new Container();

        // Card glow
        const glow = new Graphics();
        glow.roundRect(-width / 2 - 5, -height / 2 - 5, width + 10, height + 10, 15);
        glow.fill({ color: COLORS.primary, alpha: 0.3 });
        container.addChild(glow);

        // Card background
        const bg = new Graphics();
        bg.roundRect(-width / 2, -height / 2, width, height, 12);
        bg.fill({ color: 0x1a1a1a, alpha: 0.8 });
        bg.stroke({ color: COLORS.primary, width: 2 });
        container.addChild(bg);

        // Gradient overlay
        const overlay = new Graphics();
        overlay.roundRect(-width / 2, -height / 2, width, height / 2, 12);
        overlay.fill({ color: COLORS.primary, alpha: 0.1 });
        container.addChild(overlay);

        const isRed = card.suit === Suit.HEART || card.suit === Suit.DIAMOND;
        const color = isRed ? COLORS.cardRed : COLORS.cardBlack;

        // Rank
        const rankText = new Text({
            text: this.getRankString(card.rank),
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 32,
                fontWeight: '700',
                fill: color,
            },
        });
        rankText.anchor.set(0.5);
        rankText.y = -15;
        container.addChild(rankText);

        // Suit
        const suitText = new Text({
            text: this.getSuitSymbol(card.suit),
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: 40,
                fill: color,
            },
        });
        suitText.anchor.set(0.5);
        suitText.y = 30;
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
                // Empty placeholder
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
        bg.roundRect(-width / 2, -height / 2, width, height, 8);
        bg.fill({ color: 0x1a1a1a, alpha: 0.8 });
        bg.stroke({ color: 0x444444, width: 1 });
        container.addChild(bg);

        const isRed = card.suit === Suit.HEART || card.suit === Suit.DIAMOND;
        const color = isRed ? COLORS.cardRed : COLORS.cardBlack;

        const rankText = new Text({
            text: this.getRankString(card.rank),
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 20,
                fontWeight: '700',
                fill: color,
            },
        });
        rankText.anchor.set(0.5);
        rankText.y = -12;
        container.addChild(rankText);

        const suitText = new Text({
            text: this.getSuitSymbol(card.suit),
            style: {
                fontFamily: 'Inter, sans-serif',
                fontSize: 24,
                fill: color,
            },
        });
        suitText.anchor.set(0.5);
        suitText.y = 15;
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
            case Suit.SPADE: return 'S';
            case Suit.HEART: return 'H';
            case Suit.CLUB: return 'C';
            case Suit.DIAMOND: return 'D';
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

// Opponent view with state
class OpponentView extends Container {
    private avatarFrame: Graphics;
    private nameText: Text;
    private stackText: Text;
    private statusText: Text;
    private cardBacks: Container;
    private shownCards: Container;
    private _index: number;
    public userId: number = -1; // Track which user is here

    constructor(index: number) {
        super();
        this._index = index;

        // Hexagon avatar frame
        this.avatarFrame = new Graphics();
        this.drawHexagon(this.avatarFrame, 30, 0x333333, 0.5);
        this.addChild(this.avatarFrame);

        // Card backs (small, shown above avatar)
        this.cardBacks = new Container();
        this.cardBacks.y = -50;
        this.cardBacks.visible = false;
        this.addChild(this.cardBacks);

        // Create mini card backs
        for (let i = 0; i < 2; i++) {
            const cardBack = new Graphics();
            cardBack.roundRect((i - 1) * 18 + 2, -15, 20, 30, 3);
            cardBack.fill({ color: 0x1e40af });
            cardBack.stroke({ color: 0x3b82f6, width: 1 });
            this.cardBacks.addChild(cardBack);
        }

        // Shown cards
        this.shownCards = new Container();
        this.shownCards.y = -50;
        this.addChild(this.shownCards);

        // Name
        this.nameText = new Text({
            text: 'EMPTY',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 10,
                fontWeight: '700',
                fill: 0x888888,
            },
        });
        this.nameText.anchor.set(0.5);
        this.nameText.y = 40;
        this.addChild(this.nameText);

        // Stack
        this.stackText = new Text({
            text: '',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 9,
                fill: COLORS.cyan,
            },
        });
        this.stackText.anchor.set(0.5);
        this.stackText.y = 52;
        this.addChild(this.stackText);

        // Status (THINKING, FOLDED, etc.)
        this.statusText = new Text({
            text: '',
            style: {
                fontFamily: 'Space Grotesk, Inter, sans-serif',
                fontSize: 9,
                fontWeight: '700',
                fill: COLORS.cyan,
            },
        });
        this.statusText.anchor.set(0.5);
        this.statusText.y = 52;
        this.statusText.visible = false;
        this.addChild(this.statusText);

        // Default empty state
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
        g.stroke({ color: 0x444444, width: 2 });
    }

    setPlayer(player: PlayerState): void {
        this.userId = player.userId;
        this.visible = true; // Make sure view is visible

        this.nameText.text = `PLAYER_${player.userId}`;
        this.stackText.text = `$${player.stack}`;
        this.stackText.visible = !player.folded;

        if (player.folded) {
            this.statusText.text = 'FOLDED';
            this.statusText.style.fill = 0x666666;
            this.statusText.visible = true;
            this.avatarFrame.alpha = 0.5;
            this.cardBacks.visible = false;
        } else {
            this.statusText.visible = false;
            this.avatarFrame.alpha = 1;
            // Only show card backs if we don't have shown cards yet
            this.cardBacks.visible = this.shownCards.children.length === 0;
        }

        // Redraw avatar frame with active color
        this.avatarFrame.clear();
        const frameColor = player.folded ? 0x333333 : COLORS.primary;
        this.drawHexagon(this.avatarFrame, 30, 0x1a1a1a, 1);
        this.avatarFrame.stroke({ color: frameColor, width: 2, alpha: player.folded ? 0.3 : 0.6 });
    }

    showCards(cards: Card[]): void {
        this.cardBacks.visible = false;
        this.shownCards.removeChildren();

        const cardW = 30;
        const cardH = 45;
        const gap = 4;

        cards.forEach((card, i) => {
            const container = new Container();
            container.x = (i - 0.5) * (cardW + gap);

            // bg
            const bg = new Graphics();
            bg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 4);
            bg.fill({ color: 0x1a1a1a });
            bg.stroke({ color: 0x888888, width: 1 });
            container.addChild(bg);

            // rank (simple text)
            const isRed = card.suit === Suit.HEART || card.suit === Suit.DIAMOND;
            const color = isRed ? 0xff4444 : 0xcccccc;

            const text = new Text({
                text: this.getRankString(card.rank),
                style: { fontFamily: 'Arial', fontSize: 14, fill: color, fontWeight: 'bold' }
            });
            text.anchor.set(0.5);
            container.addChild(text);

            this.shownCards.addChild(container);
        });
    }

    setActive(isActive: boolean): void {
        if (isActive) {
            this.statusText.text = 'THINKING...';
            this.statusText.style.fill = COLORS.cyan;
            this.statusText.visible = true;
            this.stackText.visible = true;

            // Redraw with cyan glow
            this.avatarFrame.clear();
            this.drawHexagon(this.avatarFrame, 30, 0x1a1a1a);
            this.avatarFrame.stroke({ color: COLORS.cyan, width: 3 });
        }
    }

    clearCards(): void {
        this.cardBacks.visible = false; // Hide backs
        this.shownCards.removeChildren(); // Hide shown
    }

    clear(): void {
        this.userId = -1;
        this.nameText.text = 'EMPTY';
        this.stackText.text = '';
        this.visible = false; // Hide empty seats
    }

    // Helper for simple rank string (duplicate of TableScene method basically)
    private getRankString(rank: Rank): string {
        // Minimal impl
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



