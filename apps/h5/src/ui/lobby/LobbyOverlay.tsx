import { useUiStore } from '../../store/uiStore';
import './lobby-overlay.css';

export function LobbyOverlay(): JSX.Element | null {
    const currentScene = useUiStore((s) => s.currentScene);
    const quickStartPhase = useUiStore((s) => s.quickStartPhase);
    const quickStartLabel = useUiStore((s) => s.quickStartLabel);
    const quickStartError = useUiStore((s) => s.quickStartError);
    const startQuickStart = useUiStore((s) => s.startQuickStart);

    if (currentScene !== 'lobby') {
        return null;
    }

    const busy = quickStartPhase === 'connecting' || quickStartPhase === 'sitting';

    return (
        <div className="lobby-overlay">
            <button
                className="lobby-quick-start-btn"
                type="button"
                disabled={busy}
                onClick={() => {
                    void startQuickStart();
                }}
            >
                {quickStartLabel}
            </button>
            {quickStartError ? (
                <div className="lobby-quick-start-error">{quickStartError}</div>
            ) : null}
        </div>
    );
}
