import { SoundAssets } from './SoundMap';

class AudioManager {
    private sounds: Map<string, HTMLAudioElement> = new Map();
    private _muted: boolean = false;
    private _volume: number = 0.5;
    private _initialized: boolean = false;

    constructor() {
        // Load settings from local storage if available
        const savedVolume = localStorage.getItem('audio_volume');
        const savedMuted = localStorage.getItem('audio_muted');

        if (savedVolume !== null) {
            this._volume = parseFloat(savedVolume);
        }
        if (savedMuted !== null) {
            this._muted = savedMuted === 'true';
        }
    }

    public async init() {
        if (this._initialized) return;

        // Preload sounds
        console.log('Audio: Initializing and preloading assets...');
        const promises = Object.entries(SoundAssets).map(([key, path]) => {
            return new Promise<void>((resolve) => {
                const audio = new Audio(path);
                audio.volume = this._volume;
                audio.muted = this._muted;
                // Preload metadata
                audio.preload = 'auto';

                // Store in map
                this.sounds.set(key, audio);

                // Simple load check (not blocking strict)
                audio.oncanplaythrough = () => resolve();
                audio.onerror = () => {
                    // console.warn(`Audio: Failed to load ${path}`);
                    resolve(); // Resolve anyway to proceed
                };

                // Force load
                audio.load();
            });
        });

        // We don't strictly wait for all to be "canplaythrough" to avoid blocking start,
        // but it's good practice to kick them off.
        await Promise.race([
            Promise.all(promises),
            new Promise(r => setTimeout(r, 2000)) // 2s timeout
        ]);

        this._initialized = true;
        console.log('Audio: Initialization complete.');
    }

    public async unlock() {
        // Play a silent sound to unlock audio context in browsers
        console.log('Audio: Manually unlocking audio context...');
        const silent = new Audio();
        // Use a tiny silent base64 mp3 if possible, but just playing any sound on user click usually works
        try {
            await silent.play();
        } catch (e) {
            // This is expected if not on user gesture, but calling it FROM a user gesture will unlock
        }
    }

    public play(key: string, volumeScale: number = 1.0) {
        if (!this._initialized) {
            console.warn(`Audio: Attempted to play '${key}' before initialization.`);
            return;
        }
        const sound = this.sounds.get(key);
        if (sound) {
            // Clone node for overlapping sounds (concurrency) or reset time
            // For simple SFX, cloning is better to allow rapid fire (like chip bets)
            const playSound = async (s: HTMLAudioElement) => {
                s.volume = this._volume * volumeScale;
                s.muted = this._muted;
                console.log(`Audio: Playing '${key}' (vol: ${s.volume}, muted: ${s.muted}, src: ${s.src})`);
                try {
                    if (s.paused) {
                        s.currentTime = 0;
                    }
                    await s.play();
                } catch (e) {
                    console.error(`Audio: Playback failed for '${key}'. Browser may have blocked it. Click anywhere to unlock.`, e);
                }
            };

            if (!sound.paused) {
                const clone = sound.cloneNode() as HTMLAudioElement;
                playSound(clone);
            } else {
                playSound(sound);
            }
        } else {
            console.warn(`Audio: Missing sound key '${key}'`);
        }
    }

    public setVolume(volume: number) {
        this._volume = Math.max(0, Math.min(1, volume));
        this.sounds.forEach(s => s.volume = this._volume);
        localStorage.setItem('audio_volume', this._volume.toString());
    }

    public getVolume(): number {
        return this._volume;
    }

    public setMuted(muted: boolean) {
        this._muted = muted;
        this.sounds.forEach(s => s.muted = this._muted);
        localStorage.setItem('audio_muted', this._muted.toString());
    }

    public isMuted(): boolean {
        return this._muted;
    }

    public toggleMute() {
        this.setMuted(!this._muted);
    }
}

export const audioManager = new AudioManager();
