/* global describe, it, expect */
'use strict';

// TOGASHI TADAKATSU AT THE LIVE PROMPT.
//
// `conflictflow.ts:defenderChoosesRing` builds a SelectRingPrompt with
// `source: 'Defender chooses conflict ring'` and an activePromptTitle naming
// the attacker. The bot must recognise it and hand over the ring the ATTACKER
// wants least, not the one it would take itself.
//
// This is the prompt shape the bot actually receives, so it also pins the
// detection: `playerState.conflict` is deliberately absent, because
// `updateCurrentConflict` only publishes the conflict summary AFTER this ring
// is chosen — at this prompt it still describes the previous conflict.

const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');

const DEFENDER_RING_PROMPT = {
    promptTitle: 'Defender chooses conflict ring',
    menuTitle: "Choose a ring for Attacker's conflict"
};

function state(rings, overrides) {
    return {
        players: {
            'Jigoku Bot': Object.assign({
                name: 'Jigoku Bot',
                id: 'bot',
                phase: 'conflict',
                selectRing: true,
                buttons: [],
                stats: { honor: 10, fate: 5, conflictsRemaining: 1 },
                cardPiles: { hand: [], cardsInPlay: [] }
            }, DEFENDER_RING_PROMPT, overrides || {}),
            Attacker: {
                name: 'Attacker',
                id: 'attacker',
                stats: { honor: 10, fate: 5, conflictsRemaining: 1 },
                cardPiles: { hand: [], cardsInPlay: [] }
            }
        },
        rings
    };
}

const ring = (element, fate = 0) => ({ element, fate, unselectable: false });

function decide(rings, overrides) {
    return new JigokuBotPolicy('tadakatsu').decide(state(rings, overrides), 'Jigoku Bot');
}

describe('defender-chosen conflict ring (Togashi Tadakatsu)', function() {
    it('never hands the attacker a ring carrying fate when a bare one exists', function() {
        // The live defect: 2026-08-23 Phoenix vs Dragon, round 5 conflict 1.
        // The bot gave away the void ring with 2 fate on it, which the attacker
        // banks at declaration.
        const decision = decide({
            void: ring('void', 2),
            air: ring('air'),
            earth: ring('earth'),
            fire: ring('fire'),
            water: ring('water')
        });
        expect(decision.command).toBe('ringClicked');
        expect(decision.reason).toBe('defender-ring-worst-for-attacker');
        expect(decision.args[0]).not.toBe('void');
    });

    it('prices the fate pile inside the score, not as an afterthought', function() {
        // air is the WEAKEST element base (15 against fire's 30), so an
        // element-only ranking would hand air over. It is carrying three fate,
        // which `ringScore` prices as the dominant term from the attacker's
        // side, so the empty fire ring goes instead. The explicit fate
        // tie-break exists only for rings the attacker values equally.
        const decision = decide({
            air: ring('air', 3),
            fire: ring('fire', 0)
        });
        expect(decision.args[0]).toBe('fire');
        expect(decision.reason).toBe('defender-ring-worst-for-attacker');
    });

    it('avoids void while the attacker has fate on the board to strip', function() {
        // `ringElementBase` prices void at 50 for a player with a fated enemy
        // character to strip and 10 otherwise -- read from the ATTACKER's side
        // here, which is the whole point of the inversion.
        const board = state({
            void: ring('void'),
            water: ring('water')
        });
        // Our characters carry the fate, so VOID is what the attacker wants.
        board.players['Jigoku Bot'].cardPiles.cardsInPlay = [
            { uuid: 'ours', type: 'character', fate: 2, bowed: false }
        ];
        const decision = new JigokuBotPolicy('tadakatsu').decide(board, 'Jigoku Bot');
        expect(decision.args[0]).toBe('water');
    });

    it('is deterministic', function() {
        const rings = { void: ring('void', 2), air: ring('air'), earth: ring('earth') };
        expect(decide(rings)).toEqual(decide(rings));
    });

    it('leaves an ordinary ring prompt alone', function() {
        // Same board, a plain "Choose a ring" prompt: the bot is taking a ring,
        // not giving one, so it must still pick the BEST one for itself.
        const decision = decide(
            { air: ring('air'), earth: ring('earth') },
            { promptTitle: 'Ring', menuTitle: 'Choose a ring' }
        );
        expect(decision.args[0]).toBe('earth');
        expect(decision.reason).not.toBe('defender-ring-worst-for-attacker');
    });

    it('recognises the prompt from the menu title alone', function() {
        const decision = decide(
            { void: ring('void', 2), air: ring('air') },
            { promptTitle: 'Some Adapter Title' }
        );
        expect(decision.reason).toBe('defender-ring-worst-for-attacker');
        expect(decision.args[0]).toBe('air');
    });
});
