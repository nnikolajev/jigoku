const {
    DEFAULT_CONFLICT_CARD_ECONOMY,
    planConflictCards
} = require('../../../build/server/game/bots/ConflictCardEconomy.js');

describe('conflict card economy planner', function() {
    const option = (key, priority, cost, legacyIndex, extras = {}) => ({
        card: { uuid: key },
        key,
        priority,
        contribution: 0,
        abilityValue: false,
        cost,
        legacyIndex,
        ...extras
    });

    it('returns the complete best multi-card plan within live fate', function() {
        const plan = planConflictCards([
            option('expensive', 8, 4, 0),
            option('cheap-one', 7, 2, 1),
            option('cheap-two', 7, 2, 2)
        ], 4, DEFAULT_CONFLICT_CARD_ECONOMY);

        expect(plan.map((entry) => entry.key)).toEqual(['cheap-one', 'cheap-two']);
    });

    it('sequences a protected expensive answer before weak free filler', function() {
        const plan = planConflictCards([
            option('filler', 5, 0, 0),
            option('strategic', 9, 2, 1)
        ], 2, DEFAULT_CONFLICT_CARD_ECONOMY);

        expect(plan.map((entry) => entry.key)).toEqual(['strategic', 'filler']);
    });

    it('preserves exact legacy order when any printed cost is unknown', function() {
        const plan = planConflictCards([
            option('first', 5, undefined, 0),
            option('second', 10, 0, 1)
        ], 5, DEFAULT_CONFLICT_CARD_ECONOMY);

        expect(plan.map((entry) => entry.key)).toEqual(['first', 'second']);
    });

    it('counts a visible card UUID only once', function() {
        const plan = planConflictCards([
            option('same-card', 9, 1, 0),
            option('same-card', 9, 1, 1),
            option('other-card', 8, 1, 2)
        ], 2, DEFAULT_CONFLICT_CARD_ECONOMY);

        expect(plan.map((entry) => entry.key)).toEqual(['same-card', 'other-card']);
    });
});
