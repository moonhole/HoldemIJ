import { useEffect, useState } from 'react';
import { audioManager } from '../../audio/AudioManager';

export function AudioToggle(): JSX.Element {
    const [muted, setMuted] = useState(audioManager.isMuted());

    useEffect(() => {
        // Polling or event listener would be better, but for now simple local state is okay
        // if we don't change it from elsewhere.
        // Ideally AudioManager should extend EventEmitter or use a store used by React.
        // For this MVP, we just sync on mount and click.
        setMuted(audioManager.isMuted());
    }, []);

    const toggle = () => {
        audioManager.unlock();
        audioManager.toggleMute();
        setMuted(audioManager.isMuted());
    };

    return (
        <button
            type="button"
            className="lobby-icon-btn audio-toggle-btn"
            onClick={toggle}
            title={muted ? "Unmute Audio" : "Mute Audio"}
        >
            <span className="material-symbols-outlined">
                {muted ? 'volume_off' : 'volume_up'}
            </span>
        </button>
    );
}
