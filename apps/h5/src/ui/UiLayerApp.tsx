import { ActionOverlay } from './actions/ActionOverlay';
import { LoginOverlay } from './auth/LoginOverlay';
import { LobbyOverlay } from './lobby/LobbyOverlay';
import { ReiOverlay } from './rei/ReiOverlay';
import { ReplayOverlay } from './replay/ReplayOverlay';

export function UiLayerApp(): JSX.Element {
    return (
        <div className="ui-root" style={{ pointerEvents: 'none' }}>
            <LoginOverlay />
            <LobbyOverlay />
            <ReplayOverlay />
            <ReiOverlay />
            <ActionOverlay />
        </div>
    );
}
