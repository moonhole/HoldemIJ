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
    type Showdown,
    type HandEnd,
    type SeatUpdate,
} from '@gen/messages_pb';

type MessageHandler = {
    onSnapshot?: (snapshot: TableSnapshot) => void;
    onActionPrompt?: (prompt: ActionPrompt) => void;
    onHandStart?: (start: HandStart) => void;
    onHoleCards?: (cards: DealHoleCards) => void;
    onBoard?: (board: DealBoard) => void;
    onActionResult?: (result: ActionResult) => void;
    onShowdown?: (showdown: Showdown) => void;
    onHandEnd?: (end: HandEnd) => void;
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
    private handlers: MessageHandler = {};
    private reconnectTimer: number | null = null;

    // Track which chair we're sitting at
    public myChair: number = -1;

    // Cached state for late-loading scenes
    public lastSnapshot: TableSnapshot | null = null;
    public lastHoleCards: DealHoleCards | null = null;
    public lastActionPrompt: ActionPrompt | null = null;
    public lastHandStart: HandStart | null = null;

    constructor(url: string = '/ws') {
        // Use relative URL for dev proxy
        this.url = url.startsWith('/')
            ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${url}`
            : url;
    }

    setHandlers(handlers: MessageHandler): void {
        this.handlers = handlers;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    console.log('[GameClient] Connected');
                    this.handlers.onConnect?.();
                    resolve();
                };

                this.ws.onclose = (event) => {
                    console.log('[GameClient] Disconnected', event.code, event.reason);
                    this.handlers.onDisconnect?.();
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
                    this.lastSnapshot = env.payload.value;
                    this.handlers.onSnapshot?.(env.payload.value);
                    break;
                case 'actionPrompt':
                    this.lastActionPrompt = env.payload.value;
                    this.handlers.onActionPrompt?.(env.payload.value);
                    break;
                case 'handStart':
                    this.lastHandStart = env.payload.value;
                    // Clear hole cards on new hand
                    this.lastHoleCards = null;
                    this.lastActionPrompt = null;
                    this.handlers.onHandStart?.(env.payload.value);
                    break;
                case 'dealHoleCards':
                    this.lastHoleCards = env.payload.value;
                    this.handlers.onHoleCards?.(env.payload.value);
                    break;
                case 'dealBoard':
                    this.handlers.onBoard?.(env.payload.value);
                    break;
                case 'actionResult':
                    this.handlers.onActionResult?.(env.payload.value);
                    break;
                case 'showdown':
                    this.handlers.onShowdown?.(env.payload.value);
                    break;
                case 'handEnd':
                    this.handlers.onHandEnd?.(env.payload.value);
                    break;
                case 'seatUpdate':
                    this.handlers.onSeatUpdate?.(env.payload.value);
                    break;
                case 'error':
                    console.error('[GameClient] Server error', env.payload.value.code, env.payload.value.message);
                    this.handlers.onError?.(env.payload.value.code, env.payload.value.message);
                    break;
            }
        } catch (error) {
            console.error('[GameClient] Failed to parse message', error);
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

    raise(amount: bigint): void {
        this.action(ActionType.ACTION_RAISE, amount);
    }

    allIn(): void {
        this.action(ActionType.ACTION_ALLIN);
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
