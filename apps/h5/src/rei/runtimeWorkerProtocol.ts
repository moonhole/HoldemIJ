import type { ReiRuntimeState } from './runtimeEngine';
import type { ReiRuntimeInput } from './types';

export type ReiWorkerRequestMessage = {
    type: 'tick';
    input: ReiRuntimeInput;
};

export type ReiWorkerResponseMessage = {
    type: 'tickResult';
    state: ReiRuntimeState;
    changed: boolean;
};
