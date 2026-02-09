import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
    ClientEnvelopeSchema,
    ServerEnvelopeSchema,
    JoinTableRequestSchema,
    SitDownRequestSchema,
    ActionRequestSchema,
    ActionType,
    type ClientEnvelope,
    type TableSnapshot,
    type ActionPrompt,
    type HandStart,
    type DealHoleCards,
    type DealBoard,
    type ActionResult,
    type PotUpdate,
    type PhaseChange,
    type Showdown,
    type HandEnd,
    type WinByFold,
    type SeatUpdate,
} from '@gen/messages_pb';

export type MessageHandler = {
    onSnapshot?: (snapshot: TableSnapshot) => void;
    onActionPrompt?: (prompt: ActionPrompt) => void;
    onHandStart?: (start: HandStart) => void;
    onHoleCards?: (cards: DealHoleCards) => void;
    onBoard?: (board: DealBoard) => void;
    onPotUpdate?: (update: PotUpdate) => void;
    onPhaseChange?: (phaseChange: PhaseChange) => void;
    onActionResult?: (result: ActionResult) => void;
    onShowdown?: (showdown: Showdown) => void;
    onHandEnd?: (end: HandEnd) => void;
    onWinByFold?: (winByFold: WinByFold) => void;
    onError?: (code: number, message: string) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onSeatUpdate?: (seatUpdate: SeatUpdate) => void;
};

export class GameClient {
    private ws: WebSocket | null = null;
    private url: string;
    private seq = 0n;
    private ack = 0n;
    private tableId = '';
    public userId = 0;
    private listeners = new Set<MessageHandler>();
    private reconnectTimer: number | null = null;

    // Track which chair we're sitting at
    public myChair: number = -1;

    // Cached state for late-loading scenes
    public lastSnapshot: TableSnapshot | null = null;
    public lastHoleCards: DealHoleCards | null = null;
    public lastActionPrompt: ActionPrompt | null = null;
    public lastHandStart: HandStart | null = null;
    public lastPotUpdate: PotUpdate | null = null;
    public lastPhaseChange: PhaseChange | null = null;
    private myBet: bigint = 0n;

    constructor(url: string = '/ws') {
        // Use relative URL for dev proxy
        this.url = url.startsWith('/')
            ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${url}`
            : url;
    }

    subscribe(handlers: MessageHandler): () => void {
        this.listeners.add(handlers);
        return () => {
            this.listeners.delete(handlers);
        };
    }

    private notify(run: (h: MessageHandler) => void): void {
        for (const listener of this.listeners) {
            run(listener);
        }
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    console.log('[GameClient] Connected');
                    this.notify((h) => h.onConnect?.());
                    resolve();
                };

                this.ws.onclose = (event) => {
                    console.log('[GameClient] Disconnected', event.code, event.reason);
                    this.notify((h) => h.onDisconnect?.());
                    this.scheduleReconnect();
                };

                this.ws.onerror = (error) => {
                    console.error('[GameClient] Error', error);
                    reject(error);
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data as ArrayBuffer);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            console.log('[GameClient] Reconnecting...');
            this.connect().catch(console.error);
        }, 3000);
    }

    private handleMessage(data: ArrayBuffer): void {
        try {
            const env = fromBinary(ServerEnvelopeSchema, new Uint8Array(data));
            console.log('[GameClient] Received', env.payload.case, env.serverSeq);

            // Update ack
            this.ack = env.serverSeq;
            this.tableId = env.tableId;

            switch (env.payload.case) {
                case 'tableSnapshot':
                    {
                        const value = env.payload.value;
                        this.lastSnapshot = value;
                        this.lastPotUpdate = null;
                        this.lastPhaseChange = null;
                        this.syncHeroFromSnapshot(value);
                        this.notify((h) => h.onSnapshot?.(value));
                        break;
                    }
                case 'actionPrompt':
                    {
                        const value = env.payload.value;
                        this.lastActionPrompt = value;
                        this.notify((h) => h.onActionPrompt?.(value));
                        break;
                    }
                case 'handStart':
                    {
                        const value = env.payload.value;
                        this.lastHandStart = value;
                        // Clear hole cards on new hand
                        this.lastHoleCards = null;
                        this.lastActionPrompt = null;
                        this.lastPotUpdate = null;
                        this.lastPhaseChange = null;
                        this.resetHeroRoundState();
                        this.notify((h) => h.onHandStart?.(value));
                        break;
                    }
                case 'dealHoleCards':
                    {
                        const value = env.payload.value;
                        this.lastHoleCards = value;
                        this.notify((h) => h.onHoleCards?.(value));
                        break;
                    }
                case 'dealBoard':
                    {
                        const value = env.payload.value;
                        this.notify((h) => h.onBoard?.(value));
                        break;
                    }
                case 'potUpdate':
                    {
                        const value = env.payload.value;
                        this.lastPotUpdate = value;
                        this.notify((h) => h.onPotUpdate?.(value));
                        break;
                    }
                case 'phaseChange':
                    {
                        const value = env.payload.value;
                        this.lastPhaseChange = value;
                        this.resetHeroRoundState();
                        this.notify((h) => h.onPhaseChange?.(value));
                        break;
                    }
                case 'actionResult':
                    {
                        const value = env.payload.value;
                        this.updateHeroBetFromAction(value);
                        this.notify((h) => h.onActionResult?.(value));
                        break;
                    }
                case 'showdown':
                    {
                        const value = env.payload.value;
                        this.notify((h) => h.onShowdown?.(value));
                        break;
                    }
                case 'winByFold':
                    {
                        const value = env.payload.value;
                        this.resetHeroRoundState();
                        this.notify((h) => h.onWinByFold?.(value));
                        break;
                    }
                case 'handEnd':
                    {
                        const value = env.payload.value;
                        this.resetHeroRoundState();
                        this.notify((h) => h.onHandEnd?.(value));
                        break;
                    }
                case 'seatUpdate':
                    {
                        const value = env.payload.value;
                        this.notify((h) => h.onSeatUpdate?.(value));
                        break;
                    }
                case 'loginResponse':
                    {
                        const value = env.payload.value;
                        this.userId = value.userId;
                        console.log('[GameClient] Logged in as user', this.userId);
                        break;
                    }
                case 'error':
                    {
                        const value = env.payload.value;
                        console.error('[GameClient] Server error', value.code, value.message);
                        this.notify((h) => h.onError?.(value.code, value.message));
                        break;
                    }
            }
        } catch (error) {
            console.error('[GameClient] Failed to parse message', error);
        }
    }

    private syncHeroFromSnapshot(snapshot: TableSnapshot): void {
        if (this.userId !== 0) {
            for (const player of snapshot.players) {
                if (player.userId === this.userId) {
                    this.myChair = player.chair;
                    this.myBet = player.bet;
                    return;
                }
            }
        }

        for (const player of snapshot.players) {
            if (this.myChair !== -1 && player.chair === this.myChair) {
                this.myBet = player.bet;
                return;
            }
        }
    }

    private resetHeroRoundState(): void {
        this.myBet = 0n;
    }

    private updateHeroBetFromAction(result: ActionResult): void {
        if (this.myChair === -1) {
            return;
        }
        if (result.chair !== this.myChair) {
            return;
        }
        switch (result.action) {
            case ActionType.ACTION_BET:
            case ActionType.ACTION_RAISE:
            case ActionType.ACTION_CALL:
            case ActionType.ACTION_ALLIN:
                this.myBet = result.amount;
                break;
            case ActionType.ACTION_CHECK:
            case ActionType.ACTION_FOLD:
                break;
            default:
                break;
        }
    }

    private send(payload: ClientEnvelope['payload']): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[GameClient] Not connected');
            return;
        }

        this.seq++;
        const env = create(ClientEnvelopeSchema, {
            tableId: this.tableId,
            userId: this.userId,
            seq: this.seq,
            ack: this.ack,
            payload,
        });

        const data = toBinary(ClientEnvelopeSchema, env);
        this.ws.send(data);
        console.log('[GameClient] Sent', payload.case, 'seq', this.seq);
    }

    // Public API

    joinTable(): void {
        this.send({
            case: 'joinTable',
            value: create(JoinTableRequestSchema, {}),
        });
    }

    sitDown(chair: number, buyInAmount: bigint): void {
        this.send({
            case: 'sitDown',
            value: create(SitDownRequestSchema, {
                chair,
                buyInAmount,
            }),
        });
    }

    action(actionType: ActionType, amount: bigint = 0n): void {
        this.send({
            case: 'action',
            value: create(ActionRequestSchema, {
                action: actionType,
                amount,
            }),
        });
    }

    check(): void {
        this.action(ActionType.ACTION_CHECK);
    }

    fold(): void {
        this.action(ActionType.ACTION_FOLD);
    }

    call(amount: bigint): void {
        this.action(ActionType.ACTION_CALL, amount);
    }

    bet(amount: bigint): void {
        this.action(ActionType.ACTION_BET, amount);
    }

    raise(amount: bigint): void {
        this.action(ActionType.ACTION_RAISE, amount);
    }

    allIn(): void {
        this.action(ActionType.ACTION_ALLIN);
    }

    getMyBet(): bigint {
        return this.myBet;
    }

    disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws?.close();
        this.ws = null;
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
export const gameClient = new GameClient();
