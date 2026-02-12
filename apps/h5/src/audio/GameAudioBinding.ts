import { ActionType } from '@gen/messages_pb';
import { useReplayStore } from '../replay/replayStore';
import { useGameStore } from '../store/gameStore';
import { audioManager } from './AudioManager';
import { SoundMap } from './SoundMap';

export function setupAudioBindings() {
    let lastStreamSeq = -1;

    // Subscribe to store changes
    useGameStore.subscribe((state) => {
        // Only react to new events
        if (state.streamSeq === lastStreamSeq) return;
        lastStreamSeq = state.streamSeq;

        const event = state.lastEvent;
        if (!event) return;
        if (useReplayStore.getState().silentFx) return;

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
                switch (event.value.action) {
                    case ActionType.ACTION_FOLD:
                        audioManager.play(SoundMap.ACTION_FOLD);
                        break;
                    case ActionType.ACTION_CHECK:
                        audioManager.play(SoundMap.ACTION_CHECK);
                        break;
                    case ActionType.ACTION_CALL:
                        audioManager.play(SoundMap.ACTION_CALL);
                        break;
                    case ActionType.ACTION_RAISE:
                        audioManager.play(SoundMap.ACTION_RAISE);
                        break;
                    case ActionType.ACTION_ALLIN:
                        audioManager.play(SoundMap.ACTION_ALLIN);
                        break;
                    case ActionType.ACTION_BET:
                        audioManager.play(SoundMap.CHIP_BET);
                        break;
                    default:
                        break;
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
