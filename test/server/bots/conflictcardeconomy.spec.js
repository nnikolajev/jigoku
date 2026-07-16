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

    it('chooses the smallest exact plan that reaches province-break strength', function() {
        const plan = planConflictCards([
            option('large-pump', 9, 0, 0, { contribution: 4 }),
            option('exact-body', 8, 3, 1, { contribution: 3 }),
            option('small-pump', 7, 0, 2, { contribution: 2 })
        ], 3, DEFAULT_CONFLICT_CARD_ECONOMY, 3);

        expect(plan.map((entry) => entry.key)).toEqual(['exact-body']);
    });

    it('preserves pure strength after the break but keeps extra ability value', function() {
        const plan = planConflictCards([
            option('pure-pump', 8, 0, 0, { contribution: 3 }),
            option('draw-and-pump', 8, 0, 1, { contribution: 2, abilityValue: true }),
            option('utility', 7, 0, 2, { contribution: null, abilityValue: true })
        ], 3, DEFAULT_CONFLICT_CARD_ECONOMY, 0);

        expect(plan.map((entry) => entry.key)).toEqual(['draw-and-pump', 'utility']);
    });

    it('applies strength budgeting even when a swarm keeps legacy value ordering', function() {
        const legacySwarm = { ...DEFAULT_CONFLICT_CARD_ECONOMY, enabled: false };
        const plan = planConflictCards([
            option('large-first', 9, 0, 0, { contribution: 4 }),
            option('exact-second', 5, 3, 1, { contribution: 3 })
        ], 3, legacySwarm, 3);

        expect(plan.map((entry) => entry.key)).toEqual(['exact-second']);
    });
});
