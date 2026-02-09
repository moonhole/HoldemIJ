import type { ActionType, Card, Phase } from '@gen/messages_pb';

// Render-side state model. React/Store owns it and pushes snapshots to Pixi.
export type TableRenderState = {
    tableId: string;
    round: number;
    phase: Phase;
    potTotal: bigint;
    communityCards: Card[];
    seats: TableSeatRenderState[];
};

export type TableSeatRenderState = {
    chair: number;
    userId: number;
    stack: bigint;
    bet: bigint;
    folded: boolean;
    allIn: boolean;
    isHero: boolean;
    isActing: boolean;
    holeCards: Card[];
    revealedCards: Card[];
    showCardBacks: boolean;
};

// Pixi animation events. UI must not read/modify Pixi internals directly.
export type TableAnimationEvent =
    | { type: 'deal_hole_cards'; chair: number; cardsCount: number }
    | { type: 'deal_board_cards'; cards: Card[] }
    | { type: 'action_result'; chair: number; action: ActionType; amount: bigint }
    | { type: 'pot_award'; winners: Array<{ chair: number; amount: bigint }> };

// Pixi-only contract.
export interface TableRendererPort {
    mount(canvas: HTMLCanvasElement): Promise<void> | void;
    resize(viewport: { width: number; height: number }): void;
    render(nextState: TableRenderState): void;
    animate(event: TableAnimationEvent): Promise<void> | void;
    destroy(): void;
}

// Business intents owned by React UI layer.
export type UiIntent =
    | { type: 'join_table' }
    | { type: 'sit_down'; chair: number; buyInAmount: bigint }
    | { type: 'fold' }
    | { type: 'check' }
    | { type: 'call'; amount: bigint }
    | { type: 'raise'; amount: bigint }
    | { type: 'all_in' };

// Transport command port. React dispatches intents here; adapter maps to GameClient/proto.
export interface GameCommandPort {
    dispatch(intent: UiIntent): void;
}
