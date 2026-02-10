import { useGameStore } from '../store/gameStore';
import { audioManager } from './AudioManager';
import { SoundMap } from './SoundMap';
// import { ActionType } from '@gen/messages_pb'; // Need to check if available or use raw values

export function setupAudioBindings() {
    let lastStreamSeq = -1;

    // Subscribe to store changes
    useGameStore.subscribe((state) => {
        // Only react to new events
        if (state.streamSeq === lastStreamSeq) return;
        lastStreamSeq = state.streamSeq;

        const event = state.lastEvent;
        if (!event) return;

        // Map events to sounds
        switch (event.type) {
            case 'holeCards':
                audioManager.play(SoundMap.CARD_DEAL);
                break;
            case 'board':
                audioManager.play(SoundMap.CARD_FLIP);
                break;
            case 'actionPrompt':
                // It's my turn!
                audioManager.play(SoundMap.TURN_ALERT);
                break;
            case 'actionResult':
                // Determine action type and play corresponding sound
                // Using raw numbers or importing ActionType if possible. 
                // For now, let's look at the shape. event.value.action is the enum.
                // We'll map a few common ones.
                const { action, amount } = event.value;
                // Basic heuristic mapping
                if (action === 1) { // FOLD
                    audioManager.play(SoundMap.ACTION_FOLD);
                } else if (action === 2) { // CHECK
                    audioManager.play(SoundMap.ACTION_CHECK);
                } else if (action === 3) { // CALL
                    audioManager.play(SoundMap.CHIP_BET);
                } else if (action === 4 || action === 5) { // RAISE / ALLIN
                    audioManager.play(SoundMap.CHIP_BET);
                }
                break;
            case 'potUpdate':
                audioManager.play(SoundMap.CHIP_COLLECT);
                break;
            case 'showdown':
                // audioManager.play(SoundMap.REVEAL);
                break;
            case 'winByFold':
            case 'handEnd':
                audioManager.play(SoundMap.WIN_POT);
                break;
        }
    });

    console.log('Audio: Game bindings established.');
}
