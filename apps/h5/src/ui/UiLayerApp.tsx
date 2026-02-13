import { ActionOverlay } from './actions/ActionOverlay';
import { LoginOverlay } from './auth/LoginOverlay';
import { DesktopWorkspace } from './desktop/DesktopWorkspace';
import { LobbyOverlay } from './lobby/LobbyOverlay';
import { ReiOverlay } from './rei/ReiOverlay';
import { ReplayOverlay } from './replay/ReplayOverlay';
import { useLayoutStore } from '../store/layoutStore';

export function UiLayerApp(): JSX.Element {
    const uiProfile = useLayoutStore((s) => s.uiProfile);

    return (
        <div className="ui-root" style={{ pointerEvents: 'none' }}>
            <LoginOverlay />
            <LobbyOverlay />
            {uiProfile === 'compact' ? <ReplayOverlay /> : null}
            {uiProfile === 'compact' ? <ReiOverlay /> : null}
            <DesktopWorkspace />
            <ActionOverlay />
        </div>
    );
}
