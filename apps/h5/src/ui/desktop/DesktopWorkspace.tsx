import { useState, useEffect } from 'react';
import { DesktopChatPanel } from './DesktopChatPanel';
import { DesktopLeftRail } from './DesktopLeftRail';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { useLayoutStore } from '../../store/layoutStore';
import { useLiveUiStore } from '../../store/liveUiStore';
import { useAuthStore } from '../../store/authStore';
import { useReplayStore } from '../../replay/replayStore';
import { useUiStore } from '../../store/uiStore';
import { ReiOverlay } from '../rei/ReiOverlay';
import { ReplayOverlay } from '../replay/ReplayOverlay';
import { AudioToggle } from '../common/AudioToggle';
import './desktop-workspace.css';

type PresetSize = {
    width: number;
    height: number;
    label: string;
    isActive: boolean;
};

interface DesktopBridge {
    getPresetSizes?: () => Promise<PresetSize[]>;
    getFullScreen?: () => Promise<boolean>;
    setFullScreen?: (fullscreen: boolean) => Promise<boolean>;
    setWindowSize?: (index: number) => Promise<boolean>;
    onFullScreenChange?: (callback: (isFullScreen: boolean) => void) => () => void;
    quitApp?: () => Promise<boolean>;
}

function getDesktopBridge(): DesktopBridge | undefined {
    return (globalThis as typeof globalThis & { desktopBridge?: DesktopBridge }).desktopBridge;
}

export function DesktopWorkspace(): JSX.Element | null {
    const uiProfile = useLayoutStore((s) => s.uiProfile);
    const currentScene = useUiStore((s) => s.currentScene);
    const requestScene = useUiStore((s) => s.requestScene);
    const returnLobbyFromTable = useUiStore((s) => s.returnLobbyFromTable);
    const replayMode = useReplayStore((s) => s.mode);
    const closePlayerCard = useLiveUiStore((s) => s.closePlayerCard);
    const logout = useAuthStore((s) => s.logout);

    const isReplayReady = currentScene === 'table' && replayMode === 'loaded';
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [presetSizes, setPresetSizes] = useState<PresetSize[]>([]);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [confirmCountdown, setConfirmCountdown] = useState<number | null>(null);
    const [previousResolutionIndex, setPreviousResolutionIndex] = useState<number>(0);

    // Load preset sizes on mount
    useEffect(() => {
        const bridge = getDesktopBridge();
        if (bridge?.getPresetSizes) {
            bridge.getPresetSizes().then(setPresetSizes).catch(console.error);
        }
    }, []);

    // Load and listen for fullscreen state
    useEffect(() => {
        const bridge = getDesktopBridge();
        if (bridge?.getFullScreen) {
            bridge.getFullScreen().then(setIsFullScreen).catch(console.error);
        }
        if (bridge?.onFullScreenChange) {
            const unsubscribe = bridge.onFullScreenChange(setIsFullScreen);
            return unsubscribe;
        }
    }, []);

    const handleFullScreenToggle = async (): Promise<void> => {
        const bridge = getDesktopBridge();
        if (bridge?.setFullScreen) {
            const newFullScreen = !isFullScreen;
            const success = await bridge.setFullScreen(newFullScreen);
            if (success) {
                audioManager.play(SoundMap.UI_CLICK, 0.7);
            }
        }
    };

    const handleResolutionChange = async (index: number): Promise<void> => {
        const bridge = getDesktopBridge();
        const setWindowSize = bridge?.setWindowSize;
        const setFullScreen = bridge?.setFullScreen;
        if (!setWindowSize) {
            return;
        }

        // Save current resolution index for potential restore
        const currentActiveIndex = presetSizes.findIndex((s) => s.isActive);
        setPreviousResolutionIndex(currentActiveIndex);

        // If currently in fullscreen, temporarily exit fullscreen, change size, then re-enter
        const wasFullScreen = isFullScreen;
        if (wasFullScreen && setFullScreen) {
            await setFullScreen(false);
            // Wait for window to fully transition from fullscreen to windowed mode
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        const success = await setWindowSize(index);
        if (success) {
            setPresetSizes((prev) => prev.map((size, i) => ({ ...size, isActive: i === index })));
            audioManager.play(SoundMap.UI_CLICK, 0.7);

            // Re-enter fullscreen if we were in fullscreen mode
            if (wasFullScreen && setFullScreen) {
                // Wait a bit after resize before re-entering fullscreen
                await new Promise((resolve) => setTimeout(resolve, 200));
                await setFullScreen(true);

                // Start 10-second confirmation countdown
                setConfirmCountdown(10);
            }
        }
    };

    // Handle resolution confirmation or auto-restore
    const handleConfirmResolution = async (): Promise<void> => {
        setConfirmCountdown(null);
    };

    const handleRestoreResolution = async (): Promise<void> => {
        const bridge = getDesktopBridge();
        const setWindowSize = bridge?.setWindowSize;
        const setFullScreen = bridge?.setFullScreen;
        setConfirmCountdown(null);
        if (!setWindowSize) {
            return;
        }

        // Exit fullscreen first if in fullscreen
        if (isFullScreen && setFullScreen) {
            await setFullScreen(false);
        }

        // Restore previous resolution
        await setWindowSize(previousResolutionIndex);
        setPresetSizes((prev) => prev.map((size, i) => ({ ...size, isActive: i === previousResolutionIndex })));
        audioManager.play(SoundMap.UI_CLICK, 0.7);
    };

    // Countdown timer effect
    useEffect(() => {
        if (confirmCountdown === null || confirmCountdown <= 0) {
            if (confirmCountdown === 0) {
                // Auto-restore when countdown reaches 0
                void handleRestoreResolution();
            }
            return;
        }

        const timer = setTimeout(() => {
            setConfirmCountdown(confirmCountdown - 1);
        }, 1000);

        return () => clearTimeout(timer);
    }, [confirmCountdown]);

    const returnLobby = (): void => {
        audioManager.play(SoundMap.UI_CLICK, 0.7);
        returnLobbyFromTable();
        closePlayerCard();
    };

    if (uiProfile !== 'desktop') {
        return null;
    }

    return (
        <div className="desktop-workspace">
            {/* Resolution confirmation overlay */}
            {confirmCountdown !== null && (
                <div className="resolution-confirm-overlay">
                    <div className="resolution-confirm-dialog">
                        <div className="resolution-confirm-title">Resolution Changed</div>
                        <div className="resolution-confirm-message">
                            {confirmCountdown > 0
                                ? `Screen may be out of display area. Click to confirm or auto-restore in ${confirmCountdown}s.`
                                : 'Restoring previous resolution...'}
                        </div>
                        <div className="resolution-confirm-buttons">
                            <button
                                type="button"
                                className="resolution-confirm-btn confirm"
                                onClick={handleConfirmResolution}
                            >
                                Keep This Resolution
                            </button>
                            <button
                                type="button"
                                className="resolution-confirm-btn cancel"
                                onClick={handleRestoreResolution}
                            >
                                Restore Previous
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
                                const bridge = getDesktopBridge();
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
                        {presetSizes.length > 0 && (
                            <div className="desktop-settings-row">
                                <span className="desktop-settings-label">Resolution</span>
                                <select
                                    className="resolution-select"
                                    value={presetSizes.findIndex((s) => s.isActive)}
                                    onChange={(e) => {
                                        void handleResolutionChange(Number(e.target.value));
                                    }}
                                >
                                    {presetSizes.map((size, index) => (
                                        <option key={index} value={index}>
                                            {size.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="desktop-settings-row">
                            <span className="desktop-settings-label">Display Mode</span>
                            <button
                                type="button"
                                className={`fullscreen-toggle-btn${isFullScreen ? ' is-active' : ''}`}
                                onClick={handleFullScreenToggle}
                            >
                                <span className="material-symbols-outlined">{isFullScreen ? 'fullscreen_exit' : 'fullscreen'}</span>
                                <span>{isFullScreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
                            </button>
                        </div>
                    </section>
                )}

                <DesktopChatPanel />
            </div>
        </div>
    );
}
