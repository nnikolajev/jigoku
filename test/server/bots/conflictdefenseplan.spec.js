/* eslint-env jasmine */
const { ConflictPhasePlanner, DEFAULT_CONFLICT_PHASE_PLANNER } =
    require('../../../build/server/game/bots/ConflictPhasePlanner.js');
const { DeckConflictIntents } = require('../../../build/server/game/bots/DeckConflictIntents.js');

function character(uuid, military, political, extra = {}) {
    return Object.assign({
        uuid,
        military,
        political,
        ready: true,
        legalMilitary: true,
        legalPolitical: true,
        bowsAfterConflict: true
    }, extra);
}

function ring(element, fate = 0, selfValue = 1, opponentValue = 1) {
    return { element, fate, selfValue, opponentValue };
}

function defenseInput(overrides = {}) {
    return Object.assign({
        selfCharacters: [character('a', 5, 2), character('b', 3, 3), character('c', 1, 1)],
        opponentCharacters: [character('x', 8, 2, { inConflict: true })],
        selfOpportunities: { total: 2, military: 1, political: 1 },
        opponentOpportunities: { total: 1, military: 0, political: 1 },
        rings: [ring('air'), ring('fire')],
        selfTargets: [
            { location: 'province 1', strength: 4, priority: 0 },
            { location: 'province 2', strength: 4, priority: 1 }
        ],
        opponentTargets: [{ location: 'province 1', strength: 3, priority: 0 }],
        selfBrokenProvinces: 0,
        opponentBrokenProvinces: 0,
        actor: 'self',
        honorPressure: 0
    }, overrides);
}

function live(overrides = {}) {
    return Object.assign({
        axis: 'military',
        ringElement: 'air',
        targetLocation: 'province 1',
        targetStrength: 4,
        attackerSkill: 8,
        attackerUuids: ['x']
    }, overrides);
}

function planner() {
    return new ConflictPhasePlanner(Object.assign(
        {}, DEFAULT_CONFLICT_PHASE_PLANNER, { applyDefensePlan: true }));
}

describe('phase-aware defense planning', function() {
    it('commits the minimum body that stops the break, not the whole board', function() {
        const plan = planner().planDefense(defenseInput(), live());
        expect(plan.concede).toBe(false);
        expect(plan.provinceBroken).toBe(false);
        expect(plan.defenderUuids).toEqual(['a']);
    });

    it('wins the conflict outright when that is cheap', function() {
        const plan = planner().planDefense(defenseInput(), live({ attackerSkill: 3 }));
        expect(plan.conflictWon).toBe(true);
        expect(plan.provinceBroken).toBe(false);
    });

    it('concedes a hopeless conflict to keep the board ready', function() {
        const plan = planner().planDefense(defenseInput(), live({ attackerSkill: 40 }));
        expect(plan.concede).toBe(true);
        expect(plan.defenderUuids).toEqual([]);
    });

    it('chump-blocks a hopeless conflict once the honor actually matters', function() {
        const plan = planner().planDefense(
            defenseInput({ honorPressure: 1 }), live({ attackerSkill: 40 }));
        expect(plan.concede).toBe(false);
        // The cheapest body on the contested axis, never the best one.
        expect(plan.defenderUuids).toEqual(['c']);
    });

    it('never concedes the stronghold while it can still be held', function() {
        const plan = planner().planDefense(defenseInput(),
            live({ targetLocation: 'stronghold province', targetStronghold: true }));
        expect(plan.concede).toBe(false);
        expect(plan.provinceBroken).toBe(false);
    });

    it('keeps bodies a deck reserved for its own conflict out of the defense', function() {
        const plan = planner().planDefense(defenseInput(), live(), [
            { id: 'hold-a', reserveUuids: ['a'], bonus: 500 }
        ]);
        expect(plan.defenderUuids).not.toContain('a');
    });

    it('keeps already-committed defenders in every candidate', function() {
        const input = defenseInput({
            selfCharacters: [character('a', 5, 2), character('b', 3, 3, { inConflict: true })]
        });
        const plan = planner().planDefense(input, live({ committedDefenderUuids: ['b'] }));
        expect(plan.defenderUuids).toContain('b');
    });

    it('honours a deck rule that wants the conflict conceded', function() {
        const plan = planner().planDefense(defenseInput(), live({ attackerSkill: 3 }), [
            { id: 'give-it-up', concede: true, bonus: 500 }
        ]);
        expect(plan.concede).toBe(true);
        expect(plan.reason).toBe('defense-intent-give-it-up');
    });

    it('reports what conceding would have scored', function() {
        const plan = planner().planDefense(defenseInput(), live());
        expect(plan.concedeScore).toBeLessThan(plan.score);
    });

    it('is deterministic for the same board', function() {
        const first = planner().planDefense(defenseInput(), live());
        const second = planner().planDefense(defenseInput(), live());
        expect(second.defenderUuids).toEqual(first.defenderUuids);
        expect(second.score).toBe(first.score);
    });

    it('does not defend with a body Covert has locked out', function() {
        const plan = planner().planDefense(defenseInput(),
            live({ blockedDefenderUuids: ['a'] }));
        expect(plan.defenderUuids).not.toContain('a');
    });
});

describe('deck defense rules', function() {
    const context = {
        round: 3,
        selfCharacters: [
            character('a', 5, 2, { cardId: 'kaiu-shuichi', traits: ['bushi'] }),
            character('b', 1, 1, { cardId: 'border-rider', traits: ['cavalry'] })
        ],
        handCardIds: [],
        ringElements: ['air'],
        targets: [],
        opportunities: { total: 2, military: 1, political: 1 },
        selfBrokenProvinces: 1,
        opponentBrokenProvinces: 0,
        honor: 9,
        opponentHonor: 10,
        fate: 2
    };
    const liveCtx = {
        axis: 'military',
        ringElement: 'air',
        targetStronghold: false,
        attackerSkill: 8,
        breakInevitable: false
    };
    const build = (rule, over = {}) => new DeckConflictIntents({
        enabled: false,
        rules: [],
        defenseEnabled: true,
        defenseRules: [rule]
    }).buildDefense(context, Object.assign({}, liveCtx, over));

    it('emits nothing while defense rules are disabled', function() {
        const intents = new DeckConflictIntents({
            enabled: true,
            rules: [],
            defenseEnabled: false,
            defenseRules: [{ id: 'r' }]
        });
        expect(intents.buildDefense(context, liveCtx)).toEqual([]);
    });

    it('resolves required and reserved bodies to uuids', function() {
        const option = build({
            id: 'wall',
            requiredCardIds: ['kaiu-shuichi'],
            reserveTraits: ['cavalry'],
            reserveCount: 1
        })[0];
        expect(option.requiredDefenderUuids).toEqual(['a']);
        expect(option.reserveUuids).toEqual(['b']);
    });

    it('retires a rule whose named body is not on the board', function() {
        expect(build({ id: 'wall', requiredCardIds: ['hida-kisada'] })).toEqual([]);
    });

    it('honours the defense-specific gates', function() {
        expect(build({ id: 'g', axis: 'political' })).toEqual([]);
        expect(build({ id: 'g', ringElements: ['void'] })).toEqual([]);
        expect(build({ id: 'g', strongholdProvince: true })).toEqual([]);
        expect(build({ id: 'g', maxAttackerSkill: 4 })).toEqual([]);
        expect(build({ id: 'g', minAttackerSkill: 20 })).toEqual([]);
        expect(build({ id: 'g', minOwnConflictsRemaining: 3 })).toEqual([]);
        expect(build({ id: 'g', whenBreakInevitable: true })).toEqual([]);
        expect(build({ id: 'g', requireSelfBrokenAtLeast: 2 })).toEqual([]);
        expect(build({ id: 'g', maxHonor: 5 })).toEqual([]);
        expect(build({
            id: 'g',
            axis: 'military',
            minAttackerSkill: 5,
            requireSelfBrokenAtLeast: 1
        }).length).toBe(1);
    });

    it('offers a concede rule only once the break really is inevitable', function() {
        expect(build({ id: 'fold', concede: true, whenBreakInevitable: true })).toEqual([]);
        const offered = build({ id: 'fold', concede: true, whenBreakInevitable: true },
            { breakInevitable: true });
        expect(offered.length).toBe(1);
        expect(offered[0].concede).toBe(true);
    });
});
