import { useState } from 'react';
import { DesktopChatPanel } from './DesktopChatPanel';
import { DesktopLeftRail } from './DesktopLeftRail';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { gameClient } from '../../network/GameClient';
import { useGameStore } from '../../store/gameStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useLiveUiStore } from '../../store/liveUiStore';
import { useAuthStore } from '../../store/authStore';
import { useReplayStore } from '../../replay/replayStore';
import { useUiStore } from '../../store/uiStore';
import { ReiOverlay } from '../rei/ReiOverlay';
import { ReplayOverlay } from '../replay/ReplayOverlay';
import { AudioToggle } from '../common/AudioToggle';
import './desktop-workspace.css';

export function DesktopWorkspace(): JSX.Element | null {
    const uiProfile = useLayoutStore((s) => s.uiProfile);
    const currentScene = useUiStore((s) => s.currentScene);
    const requestScene = useUiStore((s) => s.requestScene);
    const replayMode = useReplayStore((s) => s.mode);
    const myChair = useGameStore((s) => s.myChair);
    const closePlayerCard = useLiveUiStore((s) => s.closePlayerCard);
    const logout = useAuthStore((s) => s.logout);

    const isReplayReady = currentScene === 'table' && replayMode === 'loaded';
    const [settingsOpen, setSettingsOpen] = useState(false);

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
                {isReplayReady ? (
                    <>
                        <ReplayOverlay />
                        <ReiOverlay />
                    </>
                ) : null}

                <div className="desktop-rail-system-row">
                    <button
                        type="button"
                        className={`desktop-rail-sys-btn${settingsOpen ? ' is-active' : ''}`}
                        onClick={() => {
                            audioManager.play(SoundMap.UI_CLICK, 0.7);
                            setSettingsOpen((prev) => !prev);
                        }}
                    >
                        <span className="material-symbols-outlined">settings</span>
                        <span>Settings</span>
                    </button>
                    {currentScene === 'login' ? (
                        <button
                            type="button"
                            className="desktop-rail-sys-btn"
                            onClick={() => {
                                audioManager.play(SoundMap.UI_CLICK, 0.7);
                                const bridge = (globalThis as typeof globalThis & { desktopBridge?: { quitApp?: () => Promise<boolean> } }).desktopBridge;
                                if (bridge?.quitApp) {
                                    void bridge.quitApp();
                                } else {
                                    window.close();
                                }
                            }}
                        >
                            <span className="material-symbols-outlined">close</span>
                            <span>Exit</span>
                        </button>
                    ) : currentScene === 'lobby' ? (
                        <button
                            type="button"
                            className="desktop-rail-sys-btn"
                            onClick={async () => {
                                audioManager.play(SoundMap.UI_CLICK, 0.7);
                                await logout();
                                requestScene('login');
                            }}
                        >
                            <span className="material-symbols-outlined">logout</span>
                            <span>Logout</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="desktop-rail-sys-btn"
                            onClick={returnLobby}
                        >
                            <span className="material-symbols-outlined">arrow_back</span>
                            <span>Return Lobby</span>
                        </button>
                    )}
                </div>

                {settingsOpen && (
                    <section className="desktop-rail-card desktop-settings-panel">
                        <header className="desktop-rail-head">
                            <span className="desktop-rail-title">Settings</span>
                            <button
                                type="button"
                                className="desktop-settings-close"
                                onClick={() => {
                                    audioManager.play(SoundMap.UI_CLICK, 0.5);
                                    setSettingsOpen(false);
                                }}
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </header>
                        <div className="desktop-settings-row">
                            <span className="desktop-settings-label">Audio</span>
                            <AudioToggle />
                        </div>
                    </section>
                )}

                <DesktopChatPanel />
            </div>
        </div>
    );
}
