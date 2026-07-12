const { LionTactics, LION_DEFAULTS } = require('../../../build/server/game/bots/LionTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the bushi-swarm layer (Lion precon): strategy derivation, profile
// gating (no other deck gets the tactics), and the tactic decisions.
describe('LionTactics', function() {
    const tactics = new LionTactics(LION_DEFAULTS);
    const AGGRO = { holdingEngine: false, defensive: false, aggressive: true, dishonor: false };

    describe('strategy derivation', function() {
        it('derives aggressive from the Lion swarm markers', function() {
            const strategy = deriveDeckStrategy(['way-of-the-lion', 'for-greater-glory', 'in-service-to-my-lord', 'hayaken-no-shiro']);
            expect(strategy.aggressive).toBe(true);
            expect(strategy.dishonor).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('the Lion override needs aggressive + the Lion stronghold', function() {
            const p = resolveDeckProfile(['hayaken-no-shiro', 'way-of-the-lion'], AGGRO);
            expect(p.lion).toEqual(LION_DEFAULTS);
            // Unicorn-proven defensive fixes ride along.
            expect(p.defenseCommitment).toBe('prevent-break');
            expect(p.spendCardsOnDefense).toBe(true);
            // The swarm's buffs want every body in the conflict.
            expect(p.attackCommitment).toBe('all');
            expect(p.aggressiveFate).toBe(false);
            expect(p.forceMilitaryConflict).toBe(true);
        });

        it('does NOT apply to Unicorn or generic decks', function() {
            expect(resolveDeckProfile(['cavalry-reserves'], AGGRO).lion).toBeUndefined();
            expect(resolveDeckProfile(['hayaken-no-shiro'], { holdingEngine: false, defensive: false, aggressive: false, dishonor: false }).lion).toBeUndefined();
        });
    });

    describe('honor dial', function() {
        it('bids 5 on the first round, then the draw bid', function() {
            expect(tactics.desiredBid(1, 10, false)).toBe(LION_DEFAULTS.firstRoundBid);
            expect(tactics.desiredBid(3, 10, false)).toBe(LION_DEFAULTS.drawBid);
        });

        it('bids high in duels (the deck duels bow the loser)', function() {
            expect(tactics.desiredBid(3, 10, true)).toBe(LION_DEFAULTS.duelBid);
        });

        it('collapses to 1 at the honor floor', function() {
            expect(tactics.desiredBid(3, LION_DEFAULTS.honorFloor, false)).toBe(1);
            expect(tactics.desiredBid(3, LION_DEFAULTS.honorFloor, true)).toBe(1);
        });
    });

    describe('stronghold ready', function() {
        it('clicks Hayaken no Shiro only when a known cheap Bushi sits bowed', function() {
            expect(tactics.shouldReadyWithStronghold([{ id: 'matsu-berserker', bowed: true }])).toBe(true);
            expect(tactics.shouldReadyWithStronghold([{ id: 'matsu-berserker', bowed: false }])).toBe(false);
            // Akodo Toturi costs 5 — not a legal stronghold target.
            expect(tactics.shouldReadyWithStronghold([{ id: 'akodo-toturi', bowed: true }])).toBe(false);
            expect(tactics.shouldReadyWithStronghold([])).toBe(false);
        });
    });
});
