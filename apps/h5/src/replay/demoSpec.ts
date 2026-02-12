export const demoHandSpec = {
    variant: 'NLH',
    table: { max_players: 6, sb: 50, bb: 100, ante: 0 },
    dealer_chair: 0,
    seats: [
        { chair: 0, name: 'YOU', stack: 11000, is_hero: true, hole: ['Js', 'Qc'] },
        { chair: 2, name: 'P1', stack: 8000, hole: ['As', 'Kd'] },
        { chair: 4, name: 'P2', stack: 12000, hole: ['7h', '7c'] },
    ],
    board: {
        flop: ['Ah', '7d', '2c'],
        turn: '9s',
        river: 'Td',
    },
    actions: [
        { phase: 'PREFLOP', chair: 0, type: 'CALL', amount_to: 100 },
        { phase: 'PREFLOP', chair: 2, type: 'CALL', amount_to: 100 },
        { phase: 'PREFLOP', chair: 4, type: 'CHECK', amount_to: 100 },
        { phase: 'FLOP', chair: 2, type: 'CHECK', amount_to: 0 },
        { phase: 'FLOP', chair: 4, type: 'BET', amount_to: 150 },
        { phase: 'FLOP', chair: 0, type: 'FOLD', amount_to: 0 },
        { phase: 'FLOP', chair: 2, type: 'FOLD', amount_to: 0 },
    ],
    rng: { seed: 42 },
};

