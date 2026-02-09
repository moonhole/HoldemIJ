import { ActionOverlay } from './actions/ActionOverlay';
import { LobbyOverlay } from './lobby/LobbyOverlay';

export function UiLayerApp(): JSX.Element {
    return (
        <div className="ui-root" style={{ pointerEvents: 'none' }}>
            <LobbyOverlay />
            <ActionOverlay />
        </div>
    );
}
