const {
    ConflictPhasePlanner,
    DEFAULT_CONFLICT_PHASE_PLANNER,
    RUSH_CONFLICT_PHASE_PLANNER
} = require('../../../build/server/game/bots/ConflictPhasePlanner.js');

describe('ConflictPhasePlanner', function() {
    const character = (uuid, military, political, extras = {}) => ({
        uuid, military, political, ready: true,
        legalMilitary: military > 0,
        legalPolitical: political > 0,
        bowsAfterConflict: true,
        ...extras
    });
    const ring = (element, fate = 0, selfValue = 1, opponentValue = 1) => ({
        element, fate, selfValue, opponentValue
    });
    const target = (location, strength = 4, stronghold = false) => ({
        location, strength, stronghold
    });
    const input = (extras = {}) => ({
        selfCharacters: [character('mil', 5, 1), character('pol', 1, 5)],
        opponentCharacters: [],
        selfOpportunities: { total: 2, military: 1, political: 1 },
        opponentOpportunities: { total: 0, military: 0, political: 0 },
        rings: [ring('air'), ring('earth'), ring('fire')],
        selfTargets: [target('my province')],
        opponentTargets: [target('their province')],
        selfBrokenProvinces: 0,
        opponentBrokenProvinces: 0,
        ...extras
    });

    it('preserves the other-axis specialist for the second conflict', function() {
        const plan = new ConflictPhasePlanner().plan(input({
            opponentTargets: [target('their province 1'), target('their province 2')]
        }));
        const selfAttacks = plan.sequence.filter((step) =>
            step.actor === 'self' && step.action === 'attack');
        expect(selfAttacks.length).toBe(2);
        expect(new Set(selfAttacks.map((step) => step.axis))).toEqual(new Set(['military', 'political']));
        expect(selfAttacks.find((step) => step.axis === 'military').attackerUuids).toContain('mil');
        expect(selfAttacks.find((step) => step.axis === 'political').attackerUuids).toContain('pol');
    });

    it('takes the highest-fate ring when other ring values match', function() {
        const plan = new ConflictPhasePlanner().plan(input({
            selfOpportunities: { total: 1, military: 1, political: 0 },
            rings: [ring('air', 0), ring('void', 3)]
        }));
        expect(plan.ringElement).toBe('void');
    });

    it('models an additional typed conflict opportunity', function() {
        const plan = new ConflictPhasePlanner().plan(input({
            selfCharacters: [character('stays', 5, 5, { bowsAfterConflict: false })],
            selfOpportunities: { total: 3, military: 2, political: 1 },
            rings: [ring('air'), ring('earth'), ring('fire'), ring('void')],
            opponentTargets: [
                target('their province 1'), target('their province 2'), target('their province 3')
            ]
        }));
        expect(plan.sequence.filter((step) =>
            step.actor === 'self' && step.action === 'attack').length).toBe(3);
    });

    it('accounts for Covert removing the strongest available defender', function() {
        const plan = new ConflictPhasePlanner().plan(input({
            selfCharacters: [character('covert', 4, 0, { covert: true })],
            opponentCharacters: [character('tower', 7, 0), character('helper', 1, 0)],
            selfOpportunities: { total: 1, military: 1, political: 0 },
            opponentOpportunities: { total: 0, military: 0, political: 0 },
            rings: [ring('air')],
            opponentTargets: [target('their province', 3)]
        }));
        expect(plan.action).toBe('attack');
        expect(plan.sequence[0].defenderUuids).not.toContain('tower');
        expect(plan.sequence[0].provinceBroken).toBeTrue();
    });

    it('matches the engine rule that the attacker wins a nonzero tie', function() {
        const plan = new ConflictPhasePlanner().plan(input({
            selfCharacters: [character('attacker', 4, 0)],
            opponentCharacters: [character('defender', 4, 0)],
            selfOpportunities: { total: 1, military: 1, political: 0 },
            opponentOpportunities: { total: 0, military: 0, political: 0 },
            rings: [ring('earth')],
            opponentTargets: [target('their province', 5)]
        }));
        expect(plan.sequence[0].conflictWon).toBeTrue();
        expect(plan.sequence[0].provinceBroken).toBeFalse();
    });

    it('targets the exposed stronghold as a terminal win', function() {
        const plan = new ConflictPhasePlanner().plan(input({
            selfCharacters: [character('winner', 8, 0)],
            selfOpportunities: { total: 1, military: 1, political: 0 },
            rings: [ring('fire')],
            opponentBrokenProvinces: 3,
            opponentTargets: [
                target('outer', 1),
                target('stronghold province', 7, true)
            ]
        }));
        expect(plan.targetLocation).toBe('stronghold province');
        expect(plan.sequence[0].provinceBroken).toBeTrue();
    });

    it('keeps rush aggression injectable without replacing the planner', function() {
        const regular = new ConflictPhasePlanner(DEFAULT_CONFLICT_PHASE_PLANNER);
        const rush = new ConflictPhasePlanner(RUSH_CONFLICT_PHASE_PLANNER);
        const scenario = input({
            selfCharacters: [character('body', 3, 0)],
            opponentCharacters: [character('defender', 4, 0)],
            selfOpportunities: { total: 1, military: 1, political: 0 },
            rings: [ring('water')]
        });
        expect(rush.profile.aggression).toBeGreaterThan(regular.profile.aggression);
        expect(RUSH_CONFLICT_PHASE_PLANNER.applyAttackerPlan).toBeFalse();
    });

    it('can be disabled for an exact legacy A/B', function() {
        const planner = new ConflictPhasePlanner({
            ...DEFAULT_CONFLICT_PHASE_PLANNER,
            enabled: false
        });
        expect(planner.plan(input()).action).toBe('pass');
        expect(planner.plan(input()).reason).toBe('conflict-lookahead-disabled-or-empty');
    });

    it('keeps risky integrations disabled while applying target planning', function() {
        expect(DEFAULT_CONFLICT_PHASE_PLANNER.applyPassPlan).toBeFalse();
        expect(DEFAULT_CONFLICT_PHASE_PLANNER.applyRingPlan).toBeFalse();
        expect(DEFAULT_CONFLICT_PHASE_PLANNER.applyAttackerPlan).toBeFalse();
        expect(DEFAULT_CONFLICT_PHASE_PLANNER.applyTypePlan).toBeFalse();
        expect(DEFAULT_CONFLICT_PHASE_PLANNER.applyTargetPlan).toBeTrue();
        expect(DEFAULT_CONFLICT_PHASE_PLANNER.applyDynastyProjection).toBeFalse();
    });
});
