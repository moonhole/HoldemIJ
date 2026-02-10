# Audio Assets Directory

This directory should contain the audio files for the Texas Hold'em game. 

## Audio Mapping
The application expects files to be mapped as defined in `src/audio/SoundMap.ts`. By default, it looks for `.mp3` files.

Current expected file names:
- `ui_click.mp3`
- `ui_slider.mp3`
- `ui_error.mp3`
- `ui_notify.mp3`
- `shuffle_deck.mp3`
- `game_over.mp3`
- `ding.mp3`
- `check.mp3`
- `call.mp3`
- `raise.mp3`
- `fold.mp3`
- `allin.mp3`
- `chips_stack.mp3`
- `chips_slide.mp3`
- `card_deal.mp3`
- `card_flip.mp3`
- `card_slide.mp3`
- `win_coins.mp3`

## Technical Details
- **Format**: MP3 is recommended for broad compatibility and compressed size.
- **Autoplay**: Browsers block audio until the first user interaction. The `AudioManager` includes an `unlock()` mechanism triggered on any global click/touch.
- **Graceful Failure**: If a file is missing (404), the `AudioManager` will log a warning but will not crash the game.
