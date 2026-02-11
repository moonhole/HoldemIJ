import { ActionOverlay } from './actions/ActionOverlay';
import { LoginOverlay } from './auth/LoginOverlay';
import { LobbyOverlay } from './lobby/LobbyOverlay';

export function UiLayerApp(): JSX.Element {
    return (
        <div className="ui-root" style={{ pointerEvents: 'none' }}>
            <LoginOverlay />
            <LobbyOverlay />
            <ActionOverlay />
        </div>
    );
}
