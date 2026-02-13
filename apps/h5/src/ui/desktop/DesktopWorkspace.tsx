import { DesktopLeftRail } from './DesktopLeftRail';
import { useLayoutStore } from '../../store/layoutStore';
import { useReplayStore } from '../../replay/replayStore';
import { useUiStore } from '../../store/uiStore';
import { ReiOverlay } from '../rei/ReiOverlay';
import { ReplayOverlay } from '../replay/ReplayOverlay';
import './desktop-workspace.css';

export function DesktopWorkspace(): JSX.Element | null {
    const uiProfile = useLayoutStore((s) => s.uiProfile);
    const currentScene = useUiStore((s) => s.currentScene);
    const replayMode = useReplayStore((s) => s.mode);
    const isReplayReady = currentScene === 'table' && replayMode === 'loaded';

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
                <section className="desktop-rail-card desktop-right-status-card">
                    <header className="desktop-rail-head">
                        <span className="desktop-rail-title">Explanation Console</span>
                        <span className={`desktop-rail-chip ${isReplayReady ? 'is-live' : ''}`}>
                            {isReplayReady ? 'Ready' : 'Standby'}
                        </span>
                    </header>
                    <div className="desktop-rail-grid">
                        <div className="desktop-rail-metric">
                            <span className="desktop-rail-label">Scene</span>
                            <span className="desktop-rail-value">{currentScene}</span>
                        </div>
                        <div className="desktop-rail-metric">
                            <span className="desktop-rail-label">Replay Mode</span>
                            <span className="desktop-rail-value">{replayMode}</span>
                        </div>
                    </div>
                </section>

                {isReplayReady ? (
                    <>
                        <ReplayOverlay />
                        <ReiOverlay />
                    </>
                ) : (
                    <section className="desktop-rail-card desktop-right-empty">
                        Open a replay hand from lobby to populate controls and explanation panels.
                    </section>
                )}
            </div>
        </div>
    );
}
