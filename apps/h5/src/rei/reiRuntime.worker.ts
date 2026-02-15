/// <reference lib="webworker" />

import { initialReiRuntimeState, reduceReiRuntimeState } from './runtimeEngine';
import type { ReiWorkerRequestMessage, ReiWorkerResponseMessage } from './runtimeWorkerProtocol';

let state = initialReiRuntimeState();

self.onmessage = (event: MessageEvent<ReiWorkerRequestMessage>) => {
    const message = event.data;
    if (message.type !== 'tick') {
        return;
    }

    const nextState = reduceReiRuntimeState(state, message.input);
    const changed = nextState !== state;
    if (changed) {
        state = nextState;
    }

    const response: ReiWorkerResponseMessage = {
        type: 'tickResult',
        state,
        changed,
    };
    self.postMessage(response);
};
