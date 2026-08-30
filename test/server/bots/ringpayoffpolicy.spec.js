/* global describe, it, expect */
'use strict';

// GENERIC CARD -> ELEMENT RING STEERING.
//
// Live defect 2026-08-30 (Unicorn vs Phoenix, round 1 conflict 1): the bot
// declared its first conflict with `Kudaka` as its ONLY character in play and
// contested the VOID ring. Kudaka pays 1 fate and 1 card whenever an AIR ring
// is claimed; nothing in `JigokuBotPolicy.ringElementBase` knew that, so void
// scored 50 against the opponent's fated body and air scored 15.
//
// The two Phoenix decks that run the card already steered air, each inside its
// own tactics module (`ShugenjaTactics.ringPlanKudakaAirValue`,
// `RebirthTactics.ringPayoffsByElement`), so no third deck could inherit it.
// `RingPayoffPolicy` is the generic half: keyed on the CARD in play, applied
// field-wide, and ranked BELOW the fate tier.

const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const { RingPayoffPolicy } = require('../../../build/server/game/bots/RingPayoffPolicy.js');
const { DEFAULT_PROFILE, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const fs = require('fs');
const path = require('path');
const { FIXTURES } = require('../../../tools/selfplay/deckLoader.js');

const BOT = 'Jigoku Bot';
const GENERIC = { holdingEngine: false, defensive: false, aggressive: false };
const kudaka = { id: 'kudaka', uuid: 'kudaka', type: 'character' };
const ring = (element, fate = 0) => ({ element, fate, unselectable: false });

// The live conflict-declaration prompt (`initiateconflictprompt.ts:103`).
// `me.selectRing` plus a title containing "ring" is what
// `JigokuBotPolicy.decide` gates the whole ring branch on. The exact strings
// matter: `Choose a ring for <name>'s conflict` is the DEFENDER prompt
// (Togashi Tadakatsu) and is answered by a different, inverted policy.
const DECLARATION_PROMPT = {
    promptTitle: 'Initiate Conflict',
    menuTitle: 'Choose an elemental ring\n(click the ring again to change conflict type)'
};

function state(rings, myCharacters, opponentCharacters, overrides) {
    return {
        players: {
            [BOT]: Object.assign({
                name: BOT,
                id: 'bot',
                phase: 'conflict',
                selectRing: true,
                buttons: [],
                stats: { honor: 10, fate: 5, conflictsRemaining: 2 },
                cardPiles: { hand: [], cardsInPlay: myCharacters || [] }
            }, DECLARATION_PROMPT, overrides || {}),
            Opponent: {
                name: 'Opponent',
                id: 'opponent',
                stats: { honor: 10, fate: 5, conflictsRemaining: 2 },
                cardPiles: { hand: [], cardsInPlay: opponentCharacters || [] }
            }
        },
        rings
    };
}

// The board from the replay: their only body carries fate, which is what makes
// the generic void base 50 instead of 10.
const FATED_ENEMY = [{ id: 'prodigy-of-the-waves', uuid: 'prodigy', type: 'character', fate: 3 }];

const ALL_RINGS = () => ({
    air: ring('air'),
    earth: ring('earth'),
    fire: ring('fire'),
    void: ring('void'),
    water: ring('water')
});

function pick(seed, rings, myCharacters, opponentCharacters, profile) {
    const decision = new JigokuBotPolicy(seed).decide(
        state(rings, myCharacters, opponentCharacters), BOT,
        profile ? { profile } : {}
    );
    expect(decision.command).toBe('ringClicked');
    return decision.args[0];
}

describe('RingPayoffPolicy (generic card -> element ring steering)', function() {
    it('reproduces the live defect with the policy disabled', function() {
        // The shipped-before behaviour, pinned so the fix is attributable: a
        // lone Kudaka against a fated enemy body contested void.
        const off = { ...DEFAULT_PROFILE, ringPayoff: { enabled: false } };
        expect(pick('kudaka-off', ALL_RINGS(), [kudaka], FATED_ENEMY, off)).toBe('void');
    });

    it('contests air when a Kudaka is standing on our board', function() {
        expect(pick('kudaka-on', ALL_RINGS(), [kudaka], FATED_ENEMY)).toBe('air');
    });

    it('is inert for a board without the payoff card', function() {
        // Same rings, same opponent, no Kudaka: the generic element ordering is
        // untouched, which is what makes this safe to ship field-wide.
        const other = [{ id: 'ganzu-warrior', uuid: 'ganzu', type: 'character' }];
        expect(pick('no-kudaka', ALL_RINGS(), other, FATED_ENEMY)).toBe('void');
        expect(pick('no-kudaka-empty', ALL_RINGS(), other, [])).toBe('earth');
    });

    it('still defers to a ring carrying fate', function() {
        // The attacker banks a ring's fate at DECLARATION whether or not the
        // conflict is won; Kudaka only pays once the ring is CLAIMED. So the
        // bonus sits below `ringScore`'s fate tier and any fated ring wins.
        //
        // ONE fate is the bar, on every seed. This policy class is not
        // fate-aware, so `ringScore`'s own threshold here is 2 — a live payoff
        // lowers it, otherwise the steering would quietly outrank a single-fate
        // ring on half the seeds and not on the other half.
        const rings = ALL_RINGS();
        rings.water.fate = 1;
        expect(pick('kudaka-vs-fate', rings, [kudaka], FATED_ENEMY)).toBe('water');

        rings.water.fate = 0;
        rings.fire.fate = 1;
        expect(pick('kudaka-vs-fate-fire', rings, [kudaka], FATED_ENEMY)).toBe('fire');

        // ...and takes air again as soon as the fate is gone.
        rings.fire.fate = 0;
        expect(pick('kudaka-fate-cleared', rings, [kudaka], FATED_ENEMY)).toBe('air');

        // The lowered bar is scoped to a board that actually carries a payoff:
        // with no Kudaka out, a single-fate ring is still below this policy's
        // own threshold of 2 and the element band decides.
        const noPayoff = ALL_RINGS();
        noPayoff.fire.fate = 1;
        expect(pick('no-kudaka-one-fate', noPayoff, [], FATED_ENEMY)).toBe('void');
    });

    it('beats every element the generic base can raise above air', function() {
        // The sub-fate band tops out at 75 (water with a full ready bonus,
        // earth with the omniscient threat bonus). Air's base is 15, so a
        // bonus that does not clear 60 silently does nothing on a live board.
        for(const element of ['void', 'earth', 'fire', 'water']) {
            const rings = { air: ring('air'), [element]: ring(element) };
            expect(pick('kudaka-vs-' + element, rings, [kudaka], FATED_ENEMY)).toBe('air');
        }
    });

    it('prices the OPPONENT Kudaka when the roles are inverted', function() {
        // `DefenderRingChoicePolicy.scoreForAttacker` calls `ringScore` with the
        // players swapped, so a policy keyed on the deck profile would price
        // their board with our payoffs. This one is keyed on the card in play,
        // so an air ring is exactly what we refuse to hand a Kudaka player.
        const rings = { air: ring('air'), fire: ring('fire') };
        const decision = new JigokuBotPolicy('defender-ring-kudaka').decide(
            state(rings, [], [kudaka], {
                promptTitle: 'Defender chooses conflict ring',
                menuTitle: "Choose a ring for Opponent's conflict"
            }),
            BOT
        );
        expect(decision.command).toBe('ringClicked');
        expect(decision.reason).toBe('defender-ring-worst-for-attacker');
        expect(decision.args[0]).toBe('fire');
    });

    it('ships on by default and off on the two decks that already own air', function() {
        expect(DEFAULT_PROFILE.ringPayoff.enabled).toBe(true);
        expect(DEFAULT_PROFILE.ringPayoff.payoffsByElement.air).toContain('kudaka');

        // `ShugenjaTactics.ringPlanScore` prices Kudaka in fate-equivalents,
        // `RebirthTactics.ringBonus` prices it against a fire guard that steers
        // AWAY from an element. Each list keeps exactly one owner.
        const shugenja = resolveDeckProfile(
            ['offerings-to-the-kami', 'kudaka'], { ...GENERIC, shugenja: true });
        const rebirth = resolveDeckProfile(
            ['retire-to-the-brotherhood', 'kudaka'], { ...GENERIC, rebirth: true });
        expect(shugenja.ringPayoff.enabled).toBe(false);
        expect(rebirth.ringPayoff.enabled).toBe(false);

        // Any other deck running the card keeps the generic steering.
        expect(resolveDeckProfile(['kudaka'], GENERIC).ringPayoff.enabled).toBe(true);
    });

    it('reaches the field decks that actually run the card', function() {
        // The wiring, checked against the real decklists rather than a
        // hand-written id list: whichever deck runs Kudaka must resolve a
        // profile that steers, or this policy is unreachable in live play.
        const decks = {
            UnicornReveal: 'unicorn-reveal',
            PhoenixShugenja: 'phoenix-shugenja',
            PhoenixPhoenix: 'phoenix-phoenix'
        };
        const steering = [];
        for(const [label, slug] of Object.entries(decks)) {
            const decklist = JSON.parse(fs.readFileSync(
                path.join(FIXTURES, slug + '-decklist.json'), 'utf8'));
            const ids = Object.keys(decklist.cards);
            expect(ids).toContain('kudaka');
            const profile = resolveDeckProfile(ids, deriveDeckStrategy(ids));
            if(profile.ringPayoff.enabled) {
                steering.push(label);
            }
        }
        // The two Phoenix lists price Kudaka inside their own ring models; the
        // Unicorn list had no owner at all, which is the defect this fixes.
        expect(steering).toEqual(['UnicornReveal']);
    });

    it('clones the payoff map per resolved profile', function() {
        const first = resolveDeckProfile(['kudaka'], GENERIC);
        first.ringPayoff.payoffsByElement.air.push('mutated');
        expect(resolveDeckProfile(['kudaka'], GENERIC).ringPayoff.payoffsByElement.air)
            .not.toContain('mutated');
        expect(DEFAULT_PROFILE.ringPayoff.payoffsByElement.air).not.toContain('mutated');
    });

    it('scores nothing for an element with no configured payoff', function() {
        const policy = new RingPayoffPolicy();
        expect(policy.elementBonus('air', [kudaka])).toBeGreaterThan(60);
        expect(policy.elementBonus('void', [kudaka])).toBe(0);
        expect(policy.elementBonus('air', [])).toBe(0);
        expect(new RingPayoffPolicy({ enabled: false }).elementBonus('air', [kudaka])).toBe(0);
        expect(policy.matches('air', [kudaka])).toEqual(['kudaka']);
    });
});
