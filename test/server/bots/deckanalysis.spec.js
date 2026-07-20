const {
    buildHandThreatMatrix,
    getCardModel,
    estimateHandThreat
} = require('../../../build/server/game/bots/DeckAnalysis.js');
const craneCards = require('../../../tools/selfplay/fixtures/crane-cards.json');
const craneDeck = require('../../../tools/selfplay/fixtures/crane-decklist.json');

// Regression tests for the seed-3 omniscient bot's deck analysis. Its live edge
// depends on estimateHandThreat returning a
// REALISTIC single-conflict threat — an earlier version summed the whole hand
// and crippled play (Crane mirror 0-12), so these lock the shape of the model.
describe('DeckAnalysis (seed-3 omniscient)', function() {
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

    it('covers every event and matches every modeled conflict-card cost in the default Crane opponent', function() {
        const deckIds = new Set(Object.keys(craneDeck.cards));
        const conflictCards = craneCards.filter((card) => deckIds.has(card.id) && card.side === 'conflict');
        const missingEvents = conflictCards
            .filter((card) => card.type === 'event' && !getCardModel(card.id))
            .map((card) => card.id);
        const costMismatches = conflictCards
            .filter((card) => getCardModel(card.id))
            .filter((card) => getCardModel(card.id).fate !== Number(card.cost || 0))
            .map((card) => card.id);

        expect(missingEvents).toEqual([]);
        expect(costMismatches).toEqual([]);
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

    it('finds the strongest affordable pair instead of pairing only the strongest individual cards', function() {
        const hand = [
            known('expensive-body', { type: 'character', side: 'conflict', mil: 5, fate: 2 }),
            known('efficient-body', { type: 'character', side: 'conflict', mil: 4, fate: 1 }),
            known('strong-trick', { type: 'event', swing: 6, fate: 2 })
        ];

        // The individually strongest body and trick cost 4 together. With 3
        // fate the correct plan is efficient-body (4/1f) + strong-trick
        // (6/2f), not strong-trick alone.
        const matrix = buildHandThreatMatrix(hand, 3, 'military');
        expect(matrix.map((entry) => entry.skill)).toEqual([0, 4, 6, 10]);
        expect(matrix[3].cards.map((card) => card.id)).toEqual(['efficient-body', 'strong-trick']);
        expect(estimateHandThreat(hand, 3, 'military').skill).toBe(10);
    });

    it('does not count tricks outside their legal conflict type', function() {
        const hand = [
            known('military-only', { swing: 5, fate: 1, conflictTypes: ['military'] }),
            known('political-only', { swing: 3, fate: 1, conflictTypes: ['political'] })
        ];

        expect(estimateHandThreat(hand, 1, 'military').skill).toBe(5);
        expect(estimateHandThreat(hand, 1, 'political').skill).toBe(3);
    });

    it('is 0 when the hand has nothing relevant to the conflict type', function() {
        const hand = [known('ornate-fan', { type: 'attachment', milBonus: 0, polBonus: 2, fate: 0 })];
        // ornate-fan only helps political; a military conflict sees no threat.
        expect(estimateHandThreat(hand, 5, 'military').skill).toBe(0);
        expect(estimateHandThreat(hand, 5, 'political').skill).toBe(2);
    });
});
