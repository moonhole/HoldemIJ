import type { ReplayServerTape } from './replayCodec';

type ReplayWorkerRequest = {
    id: number;
    type: 'init';
    spec: unknown;
};

type ReplayWorkerResponse = {
    id: number;
    ok: boolean;
    tape?: ReplayServerTape;
    error?: {
        step_index?: number;
        reason?: string;
        message?: string;
    };
};

export class ReplayWasmClient {
    private worker: Worker;
    private reqID = 0;
    private pending = new Map<number, {
        resolve: (v: ReplayServerTape) => void;
        reject: (e: Error) => void;
    }>();

    constructor() {
        this.worker = new Worker('/wasm/replay_worker.js');
        this.worker.onmessage = (event: MessageEvent<ReplayWorkerResponse>) => {
            const data = event.data;
            const task = this.pending.get(data.id);
            if (!task) return;
            this.pending.delete(data.id);

            if (data.ok && data.tape) {
                task.resolve(data.tape);
                return;
            }
            const msg = data.error?.message || data.error?.reason || 'replay worker failed';
            task.reject(new Error(msg));
        };
        this.worker.onerror = (event) => {
            const err = new Error(event.message || 'replay worker crashed');
            for (const task of this.pending.values()) {
                task.reject(err);
            }
            this.pending.clear();
        };
    }

    init(spec: unknown): Promise<ReplayServerTape> {
        const id = ++this.reqID;
        const req: ReplayWorkerRequest = { id, type: 'init', spec };
        return new Promise<ReplayServerTape>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage(req);
        });
    }

    dispose(): void {
        for (const task of this.pending.values()) {
            task.reject(new Error('replay worker disposed'));
        }
        this.pending.clear();
        this.worker.terminate();
    }
}

export const replayWasmClient = new ReplayWasmClient();
