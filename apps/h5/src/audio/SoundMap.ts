export const SoundMap = {
    // UI Sounds
    UI_CLICK: 'ui_click',
    UI_SLIDER: 'ui_slider',
    UI_ERROR: 'ui_error',
    UI_NOTIFY: 'ui_notify',

    // Game Flow
    GAME_START: 'game_start',
    GAME_OVER: 'game_over',
    TURN_ALERT: 'turn_alert',

    // Actions
    ACTION_CHECK: 'action_check',
    ACTION_CALL: 'action_call',
    ACTION_RAISE: 'action_raise',
    ACTION_FOLD: 'action_fold',
    ACTION_ALLIN: 'action_allin',

    // Chips & Cards
    CHIP_BET: 'chip_bet',
    CHIP_COLLECT: 'chip_collect',
    CARD_DEAL: 'card_deal',
    CARD_FLIP: 'card_flip',
    CARD_SLIDE: 'card_slide',

    // Results
    WIN_POT: 'win_pot',
};

export type SoundAssetSpec = string | { aliasOf: string };

// A sound key can point to a file path, or alias another key to share one file.
export const SoundAssets: Record<string, SoundAssetSpec> = {
    [SoundMap.UI_CLICK]: '/sounds/ui_click.mp3',
    [SoundMap.UI_SLIDER]: { aliasOf: SoundMap.UI_CLICK },
    [SoundMap.UI_ERROR]: '/sounds/ui_error.mp3',
    [SoundMap.UI_NOTIFY]: { aliasOf: SoundMap.UI_CLICK },
    [SoundMap.GAME_START]: { aliasOf: SoundMap.CARD_DEAL },
    [SoundMap.GAME_OVER]: '/sounds/game_over.mp3',
    [SoundMap.TURN_ALERT]: { aliasOf: SoundMap.UI_ERROR },
    [SoundMap.ACTION_CHECK]: '/sounds/check.mp3',
    [SoundMap.ACTION_CALL]: '/sounds/call.mp3',
    [SoundMap.ACTION_RAISE]: '/sounds/raise.mp3',
    [SoundMap.ACTION_FOLD]: '/sounds/fold.mp3',
    [SoundMap.ACTION_ALLIN]: '/sounds/allin.mp3',
    [SoundMap.CHIP_BET]: { aliasOf: SoundMap.ACTION_RAISE },
    [SoundMap.CHIP_COLLECT]: '/sounds/chips_slide.mp3',
    [SoundMap.CARD_DEAL]: '/sounds/card_deal.mp3',
    [SoundMap.CARD_FLIP]: '/sounds/card_flip.mp3',
    [SoundMap.CARD_SLIDE]: { aliasOf: SoundMap.CARD_DEAL },
    [SoundMap.WIN_POT]: '/sounds/win_coins.mp3',
};
