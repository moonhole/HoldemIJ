# Audio Assets Directory

This directory should contain the audio files for the Texas Hold'em game. 

## Audio Mapping
The application expects files to be mapped as defined in `src/audio/SoundMap.ts`. By default, it looks for `.mp3` files.

You can also map multiple sound keys to the same physical file by using an alias entry in `SoundAssets`, for example:

```ts
[SoundMap.ACTION_CALL]: { aliasOf: SoundMap.CHIP_BET },
[SoundMap.ACTION_RAISE]: { aliasOf: SoundMap.CHIP_BET },
[SoundMap.ACTION_ALLIN]: { aliasOf: SoundMap.CHIP_BET },
```

When aliases are used, only the target file is required on disk.

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
- **Trigger Model**: SFX are triggered from UI handlers (button/slider actions) and scene animation hooks (card move/flip, pot updates), instead of a direct server-event-to-sound binding layer.
- **Graceful Failure**: If a file is missing (404), the `AudioManager` will log a warning but will not crash the game.
