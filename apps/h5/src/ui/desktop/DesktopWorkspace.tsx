import { DesktopChatPanel } from './DesktopChatPanel';
import { DesktopLeftRail } from './DesktopLeftRail';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { gameClient } from '../../network/GameClient';
import { useGameStore } from '../../store/gameStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useLiveUiStore } from '../../store/liveUiStore';
import { useReplayStore } from '../../replay/replayStore';
import { useUiStore } from '../../store/uiStore';
import { ReiOverlay } from '../rei/ReiOverlay';
import { ReplayOverlay } from '../replay/ReplayOverlay';
import './desktop-workspace.css';

export function DesktopWorkspace(): JSX.Element | null {
    const uiProfile = useLayoutStore((s) => s.uiProfile);
    const currentScene = useUiStore((s) => s.currentScene);
    const requestScene = useUiStore((s) => s.requestScene);
    const replayMode = useReplayStore((s) => s.mode);
    const myChair = useGameStore((s) => s.myChair);
    const closePlayerCard = useLiveUiStore((s) => s.closePlayerCard);

    const isReplayReady = currentScene === 'table' && replayMode === 'loaded';

    const returnLobby = (): void => {
        audioManager.play(SoundMap.UI_CLICK, 0.7);
        if (myChair !== -1) {
            gameClient.standUp();
            window.setTimeout(() => {
                const state = useUiStore.getState();
                if (state.currentScene === 'lobby' && gameClient.isConnected) {
                    gameClient.disconnect();
                }
            }, 350);
        } else if (gameClient.isConnected) {
            gameClient.disconnect();
        }
        requestScene('lobby');
        closePlayerCard();
    };

    if (uiProfile !== 'desktop') {
        return null;
    }

    return (
        <div className="desktop-workspace">
            <div className="desktop-left-rail">
                <DesktopLeftRail />
            </div>
            <div className="desktop-center" />
            <div className="desktop-right-rail">
                {currentScene === 'table' && (
                    <button type="button" className="desktop-rail-return-btn" onClick={returnLobby}>
                        <span className="material-symbols-outlined">arrow_back</span>
                        <span>RETURN LOBBY</span>
                    </button>
                )}

                {isReplayReady ? (
                    <>
                        <ReplayOverlay />
                        <ReiOverlay />
                    </>
                ) : null}

                <DesktopChatPanel />
            </div>
        </div>
    );
}
