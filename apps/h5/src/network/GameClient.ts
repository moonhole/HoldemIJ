import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
    ClientEnvelopeSchema,
    ServerEnvelopeSchema,
    JoinTableRequestSchema,
    SitDownRequestSchema,
    StandUpRequestSchema,
    ActionRequestSchema,
    StartStoryRequestSchema,
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
    type StoryChapterInfo,
} from '@gen/messages_pb';
import { resolveWsUrl } from './runtimeConfig';

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
    onStoryChapterInfo?: (info: StoryChapterInfo) => void;
};

export class GameClient {
    private static readonly SESSION_TOKEN_KEY = 'holdem.session.token';
    private static readonly CONNECT_TIMEOUT_MS = 10000;

    private ws: WebSocket | null = null;
    private baseUrl: string;
    private seq = 0n;
    private ack = 0n;
    private tableId = '';
    public userId = 0n;
    private sessionToken = '';
    private listeners = new Set<MessageHandler>();
    private reconnectTimer: number | null = null;
    private shouldReconnect = true;
    private serverClockOffsetMs = 0;
    private hasServerClockSync = false;

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
    private readonly debugLogs = false;

    constructor(url: string = resolveWsUrl('/ws')) {
        this.baseUrl = url.startsWith('/') ? resolveWsUrl(url) : url;
        this.sessionToken = this.readSessionToken();
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

    private debug(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log(...args);
    }

    connect(): Promise<void> {
        this.shouldReconnect = true;
        if (this.ws?.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            let hasOpened = false;
            const finalize = (fn: () => void): void => {
                if (settled) {
                    return;
                }
                settled = true;
                fn();
            };

            try {
                if (this.ws?.readyState === WebSocket.CONNECTING) {
                    this.ws.close();
                }

                this.ws = new WebSocket(this.withSessionToken(this.baseUrl));
                this.ws.binaryType = 'arraybuffer';

                const timeoutId = window.setTimeout(() => {
                    finalize(() => {
                        this.ws?.close();
                        reject(new Error('WebSocket connect timeout'));
                    });
                }, GameClient.CONNECT_TIMEOUT_MS);

                this.ws.onopen = () => {
                    hasOpened = true;
                    finalize(() => {
                        window.clearTimeout(timeoutId);
                        this.debug('[GameClient] Connected');
                        this.notify((h) => h.onConnect?.());
                        resolve();
                    });
                };

                this.ws.onclose = (event) => {
                    window.clearTimeout(timeoutId);
                    this.debug('[GameClient] Disconnected', event.code, event.reason);
                    this.notify((h) => h.onDisconnect?.());
                    if (!hasOpened) {
                        finalize(() => reject(new Error(`WebSocket closed before ready (${event.code})`)));
                        return;
                    }
                    if (this.shouldReconnect) {
                        this.scheduleReconnect();
                    }
                };

                this.ws.onerror = (error) => {
                    finalize(() => {
                        window.clearTimeout(timeoutId);
                        console.error('[GameClient] Error', error);
                        if (!hasOpened) {
                            reject(error);
                        }
                    });
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data).catch((error) => {
                        console.error('[GameClient] Failed to handle message', error);
                    });
                };
            } catch (error) {
                finalize(() => reject(error));
            }
        });
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.debug('[GameClient] Reconnecting...');
            this.connect().catch(console.error);
        }, 3000);
    }

    private async handleMessage(data: ArrayBuffer | ArrayBufferView | Blob | string): Promise<void> {
        try {
            let bytes: Uint8Array;
            if (data instanceof ArrayBuffer) {
                bytes = new Uint8Array(data);
            } else if (ArrayBuffer.isView(data)) {
                bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            } else if (data instanceof Blob) {
                bytes = new Uint8Array(await data.arrayBuffer());
            } else {
                console.warn('[GameClient] Ignoring non-binary websocket message');
                return;
            }
            const env = fromBinary(ServerEnvelopeSchema, bytes);
            this.debug('[GameClient] Received', env.payload.case, env.serverSeq);

            this.updateServerClockOffset(Number(env.serverTsMs));

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
                        if (value.update.case === 'playerJoined' && value.update.value.userId === this.userId) {
                            this.myChair = value.chair;
                            this.myBet = value.update.value.bet;
                        } else if (value.update.case === 'playerLeftUserId') {
                            if (value.update.value === this.userId || value.chair === this.myChair) {
                                this.myChair = -1;
                                this.myBet = 0n;
                                this.lastActionPrompt = null;
                            }
                        }
                        this.notify((h) => h.onSeatUpdate?.(value));
                        break;
                    }
                case 'loginResponse':
                    {
                        const value = env.payload.value;
                        this.userId = value.userId;
                        if (value.sessionToken) {
                            this.sessionToken = value.sessionToken;
                            this.persistSessionToken(value.sessionToken);
                        }
                        if (this.lastSnapshot) {
                            // Snapshot may arrive before login response; resync hero seat after auth identity is known.
                            this.syncHeroFromSnapshot(this.lastSnapshot);
                            this.notify((h) => h.onSnapshot?.(this.lastSnapshot!));
                        }
                        this.debug('[GameClient] Logged in as user', this.userId.toString());
                        break;
                    }
                case 'error':
                    {
                        const value = env.payload.value;
                        console.error('[GameClient] Server error', value.code, value.message);
                        this.notify((h) => h.onError?.(value.code, value.message));
                        break;
                    }
                case 'storyChapterInfo':
                    {
                        const value = env.payload.value;
                        console.log('[GameClient] Story chapter info', value.title);
                        this.notify((h) => h.onStoryChapterInfo?.(value));
                        break;
                    }
            }
        } catch (error) {
            console.error('[GameClient] Failed to parse message', error);
        }
    }

    private syncHeroFromSnapshot(snapshot: TableSnapshot): void {
        if (this.userId !== 0n) {
            for (const player of snapshot.players) {
                if (player.userId === this.userId) {
                    this.myChair = player.chair;
                    this.myBet = player.bet;
                    return;
                }
            }
            this.myChair = -1;
            this.myBet = 0n;
            return;
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
        // Safari on some iOS versions is flaky with direct Uint8Array send.
        // Always send an exact ArrayBuffer slice for consistent wire bytes.
        const binary =
            data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
                ? data.buffer
                : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        this.ws.send(binary);
        this.debug('[GameClient] Sent', payload.case, 'seq', this.seq);
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

    standUp(): void {
        this.send({
            case: 'standUp',
            value: create(StandUpRequestSchema, {}),
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

    allIn(amount: bigint = 0n): void {
        this.action(ActionType.ACTION_ALLIN, amount);
    }

    startStory(chapterId: number): void {
        this.send({
            case: 'startStory',
            value: create(StartStoryRequestSchema, {
                chapterId,
            }),
        });
    }

    getMyBet(): bigint {
        return this.myBet;
    }

    getSessionToken(): string {
        return this.sessionToken;
    }

    setSessionToken(token: string): void {
        const nextToken = token.trim();
        this.sessionToken = nextToken;
        if (nextToken) {
            this.persistSessionToken(nextToken);
            return;
        }
        this.clearSessionTokenStorage();
    }

    clearSessionToken(): void {
        this.sessionToken = '';
        this.clearSessionTokenStorage();
    }

    disconnect(): void {
        this.shouldReconnect = false;
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

    getEstimatedServerNowMs(): number {
        return Date.now() + this.serverClockOffsetMs;
    }

    private updateServerClockOffset(serverTsMs: number): void {
        if (!Number.isFinite(serverTsMs) || serverTsMs <= 0) {
            return;
        }
        const sampleOffset = serverTsMs - Date.now();
        if (!this.hasServerClockSync) {
            this.serverClockOffsetMs = sampleOffset;
            this.hasServerClockSync = true;
            return;
        }
        const alpha = 0.15;
        this.serverClockOffsetMs = this.serverClockOffsetMs * (1 - alpha) + sampleOffset * alpha;
    }

    private withSessionToken(url: string): string {
        if (!this.sessionToken) {
            return url;
        }
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}session_token=${encodeURIComponent(this.sessionToken)}`;
    }

    private readSessionToken(): string {
        try {
            const key = GameClient.SESSION_TOKEN_KEY;
            const tokenInSession = window.sessionStorage.getItem(key);
            if (tokenInSession) {
                return tokenInSession;
            }

            // Migration path: move historical shared localStorage token
            // to tab-scoped sessionStorage to prevent multi-tab account takeover.
            const tokenInLocal = window.localStorage.getItem(key);
            if (tokenInLocal) {
                window.sessionStorage.setItem(key, tokenInLocal);
                window.localStorage.removeItem(key);
                return tokenInLocal;
            }
        } catch {
            // Ignore storage quota or privacy mode failures.
        }
        return '';
    }

    private persistSessionToken(token: string): void {
        try {
            const key = GameClient.SESSION_TOKEN_KEY;
            window.sessionStorage.setItem(key, token);
            // Clean old shared token to avoid cross-tab reuse after upgrade.
            window.localStorage.removeItem(key);
        } catch {
            // Ignore storage quota or privacy mode failures.
        }
    }

    private clearSessionTokenStorage(): void {
        try {
            const key = GameClient.SESSION_TOKEN_KEY;
            window.sessionStorage.removeItem(key);
            window.localStorage.removeItem(key);
        } catch {
            // Ignore storage quota or privacy mode failures.
        }
    }
}

// Singleton instance
export const gameClient = new GameClient();
