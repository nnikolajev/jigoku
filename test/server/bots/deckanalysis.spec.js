const { getCardModel, estimateHandThreat } = require('../../../build/server/game/bots/DeckAnalysis.js');

// Regression tests for the seed-4 omniscient bot's deck analysis. The live win
// (seed4 beats seed1 in mirrors) depends on estimateHandThreat returning a
// REALISTIC single-conflict threat — an earlier version summed the whole hand
// and crippled play (Crane mirror 0-12), so these lock the shape of the model.
describe('DeckAnalysis (seed-4 omniscient)', function() {
    function known(id, overrides = {}) {
        const model = getCardModel(id) || {};
        return Object.assign(
            { id, type: 'event', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'utility' },
            model,
            overrides
        );
    }

    it('models the Crane deck cards (analysis registry is populated)', function() {
        expect(getCardModel('assassination').tag).toBe('removal');
        expect(getCardModel('duel-to-the-death').swing).toBeGreaterThan(0);
        expect(getCardModel('doji-kuwanan').type).toBe('character');
        expect(getCardModel('not-a-real-card')).toBeUndefined();
    });

    it('does NOT sum the whole hand — caps at best body + best trick', function() {
        // A hand full of free swing events must not add up to a huge threat: the
        // human can realistically resolve one big answer per conflict.
        const hand = [
            known('assassination'), // swing 4, free
            known('make-your-case'), // swing 3, free
            known('issue-a-challenge'), // swing 3, free
            known('way-of-the-crane'), // swing 2, free
            known('storied-defeat') // swing 2, free
        ];
        const { skill } = estimateHandThreat(hand, 0, 'military');
        // best trick only (no conflict body in hand); NOT 4+3+3+2+2 = 14.
        expect(skill).toBe(4);
    });

    it('adds one affordable body plus one affordable trick, respecting fate', function() {
        const hand = [
            known('local-daimyo-s-retainer', { type: 'character', mil: 2, fate: 1 }), // body +2 / 1f
            known('duel-to-the-death', { swing: 5, fate: 1 }) // trick +5 / 1f
        ];
        // 2 fate pays for both: body(2) + trick(5) = 7.
        expect(estimateHandThreat(hand, 2, 'military').skill).toBe(7);
        // 1 fate pays for only the better single card the budget allows.
        expect(estimateHandThreat(hand, 1, 'military').skill).toBe(5);
        // 0 fate: nothing (both cost 1).
        expect(estimateHandThreat(hand, 0, 'military').skill).toBe(0);
    });

    it('is 0 when the hand has nothing relevant to the conflict type', function() {
        const hand = [known('ornate-fan', { type: 'attachment', milBonus: 0, polBonus: 2, fate: 0 })];
        // ornate-fan only helps political; a military conflict sees no threat.
        expect(estimateHandThreat(hand, 5, 'military').skill).toBe(0);
        expect(estimateHandThreat(hand, 5, 'political').skill).toBe(2);
    });
});
