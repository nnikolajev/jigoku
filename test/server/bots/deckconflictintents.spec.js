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

function baseInput(overrides = {}) {
    return Object.assign({
        selfCharacters: [character('a', 5, 2), character('b', 3, 4), character('c', 1, 1)],
        opponentCharacters: [character('x', 2, 2)],
        selfOpportunities: { total: 2, military: 1, political: 1 },
        opponentOpportunities: { total: 2, military: 1, political: 1 },
        rings: [ring('air'), ring('fire'), ring('water')],
        selfTargets: [{ location: 'province 1', strength: 4, priority: 0 }],
        opponentTargets: [
            { location: 'province 1', strength: 3, priority: 0 },
            { location: 'province 2', strength: 5, priority: 1 }
        ],
        selfBrokenProvinces: 0,
        opponentBrokenProvinces: 0,
        actor: 'self'
    }, overrides);
}

function plannerWithIntents(profileOverrides = {}) {
    return new ConflictPhasePlanner(Object.assign(
        {}, DEFAULT_CONFLICT_PHASE_PLANNER, { applyIntentPlan: true }, profileOverrides));
}

describe('deck conflict intents', function() {
    describe('DeckConflictIntents rule resolution', function() {
        const context = {
            round: 3,
            selfCharacters: [
                character('a', 5, 2, { cardId: 'matsu-berserker', traits: ['bushi'] }),
                character('b', 3, 4, { cardId: 'ikoma-eij', traits: ['courtier'] }),
                character('c', 1, 1, { cardId: 'ashigaru-levy', traits: ['bushi'] })
            ],
            handCardIds: ['for-greater-glory'],
            ringElements: ['air', 'fire', 'water'],
            targets: [{ location: 'province 1', strength: 3 }],
            opportunities: { total: 2, military: 1, political: 1 },
            selfBrokenProvinces: 0,
            opponentBrokenProvinces: 1,
            honor: 11,
            opponentHonor: 8,
            fate: 2
        };

        it('emits nothing when the profile is disabled', function() {
            const intents = new DeckConflictIntents({
                enabled: false,
                rules: [{ id: 'r', axis: 'military' }]
            });
            expect(intents.build(context)).toEqual([]);
        });

        it('emits one option per available preferred ring, decayed by position', function() {
            const intents = new DeckConflictIntents({
                enabled: true,
                rules: [{ id: 'ring-plan', axis: 'political', ringElements: ['fire', 'air'], bonus: 3, ringBonusStep: 1 }]
            });
            const options = intents.build(context);
            expect(options.map((option) => option.id)).toEqual(['ring-plan:fire', 'ring-plan:air']);
            expect(options[0].bonus).toBe(3);
            expect(options[1].bonus).toBe(2);
            expect(options[0].ringElement).toBe('fire');
        });

        it('skips a ring rule entirely when none of its rings are available', function() {
            const intents = new DeckConflictIntents({
                enabled: true,
                rules: [{ id: 'void-only', ringElements: ['void'] }]
            });
            expect(intents.build(context)).toEqual([]);
        });

        it('resolves required card ids to uuids and retires the rule when one is missing', function() {
            const present = new DeckConflictIntents({
                enabled: true,
                rules: [{ id: 'named', requiredCardIds: ['matsu-berserker'] }]
            });
            expect(present.build(context)[0].requiredAttackerUuids).toEqual(['a']);

            const absent = new DeckConflictIntents({
                enabled: true,
                rules: [{ id: 'named', requiredCardIds: ['toturi-the-hero'] }]
            });
            expect(absent.build(context)).toEqual([]);
        });

        it('picks the best bodies on the axis for a trait requirement', function() {
            const intents = new DeckConflictIntents({
                enabled: true,
                rules: [{ id: 'swarm', axis: 'military', requiredTraits: ['bushi'], requiredTraitCount: 2 }]
            });
            expect(intents.build(context)[0].requiredAttackerUuids).toEqual(['a', 'c']);
        });

        it('retires a trait rule when the board cannot field enough bodies', function() {
            const intents = new DeckConflictIntents({
                enabled: true,
                rules: [{ id: 'swarm', axis: 'military', requiredTraits: ['bushi'], requiredTraitCount: 3 }]
            });
            expect(intents.build(context)).toEqual([]);
        });

        it('reserves the weakest bodies on the axis, never all of them', function() {
            const intents = new DeckConflictIntents({
                enabled: true,
                rules: [{ id: 'hold', axis: 'military', reserveCount: 5 }]
            });
            const reserved = intents.build(context)[0].reserveUuids;
            expect(reserved.length).toBe(2);
            expect(reserved).toContain('c');
            expect(reserved).not.toContain('a');
        });

        it('honours the gate fields', function() {
            const gated = (rule) => new DeckConflictIntents({ enabled: true, rules: [rule] }).build(context);
            expect(gated({ id: 'g', minRound: 5 })).toEqual([]);
            expect(gated({ id: 'g', maxRound: 2 })).toEqual([]);
            expect(gated({ id: 'g', maxOpponentHonor: 5 })).toEqual([]);
            expect(gated({ id: 'g', requireHandCardIds: ['way-of-the-crane'] })).toEqual([]);
            expect(gated({ id: 'g', requireCardIdsInPlay: ['togashi-yokuni'] })).toEqual([]);
            expect(gated({ id: 'g', requireReadyCount: 4 })).toEqual([]);
            expect(gated({ id: 'g', axis: 'military', minAxisSkill: 99 })).toEqual([]);
            expect(gated({ id: 'g', minRound: 2, maxRound: 4, maxOpponentHonor: 9 }).length).toBe(1);
        });
    });

    describe('planner option scoring', function() {
        it('ignores deck options unless applyIntentPlan is on', function() {
            const planner = new ConflictPhasePlanner(DEFAULT_CONFLICT_PHASE_PLANNER);
            const plan = planner.plan(baseInput({
                options: [{ id: 'forced-political', axis: 'political', bonus: 500 }]
            }));
            expect(plan.optionId).toBeUndefined();
        });

        it('executes a deck option whose bonus carries the phase', function() {
            const plan = plannerWithIntents().plan(baseInput({
                options: [{ id: 'forced-political', axis: 'political', ringElement: 'water', bonus: 500 }]
            }));
            expect(plan.action).toBe('attack');
            expect(plan.optionId).toBe('forced-political');
            expect(plan.conflictType).toBe('political');
            expect(plan.ringElement).toBe('water');
            expect(plan.reason).toBe('conflict-intent-forced-political');
        });

        it('rejects a deck option the rollout cannot justify', function() {
            // A board with no political skill at all: no nudge this small can
            // make the deck's political wish beat the generic military line.
            const plan = plannerWithIntents().plan(baseInput({
                selfCharacters: [character('a', 5, 0), character('b', 4, 0)],
                options: [{ id: 'wishful', axis: 'political', bonus: 0.01 }]
            }));
            expect(plan.action).toBe('attack');
            expect(plan.conflictType).toBe('military');
            expect(plan.optionId).toBeUndefined();
        });

        it('keeps required attackers in the declaration', function() {
            const plan = plannerWithIntents().plan(baseInput({
                options: [{
                    id: 'must-send-c',
                    axis: 'military',
                    requiredAttackerUuids: ['c'],
                    bonus: 500
                }]
            }));
            expect(plan.attackerUuids).toContain('c');
        });

        it('sends exactly the required bodies when exactAttackers is set', function() {
            const plan = plannerWithIntents().plan(baseInput({
                options: [{
                    id: 'solo',
                    axis: 'military',
                    requiredAttackerUuids: ['a'],
                    exactAttackers: true,
                    bonus: 500
                }]
            }));
            expect(plan.attackerUuids).toEqual(['a']);
        });

        it('keeps reserved bodies out of the declaration and reports them', function() {
            const plan = plannerWithIntents().plan(baseInput({
                options: [{
                    id: 'hold-b',
                    axis: 'military',
                    reserveUuids: ['b'],
                    bonus: 500
                }]
            }));
            expect(plan.attackerUuids).not.toContain('b');
            expect(plan.reserveUuids).toEqual(['b']);
        });

        it('retires an option that fails its own minScore and falls back', function() {
            const plan = plannerWithIntents().plan(baseInput({
                options: [{ id: 'greedy', axis: 'political', bonus: 1, minScore: 10000 }]
            }));
            expect(plan.optionId).toBeUndefined();
            expect(plan.action).toBe('attack');
        });

        it('never declares with a body the global reserve holds back', function() {
            const plan = plannerWithIntents().plan(baseInput({
                reservedSelfUuids: ['a'],
                options: [{ id: 'any', axis: 'military', bonus: 500 }]
            }));
            expect(plan.attackerUuids).not.toContain('a');
        });

        it('drops an option whose required body is bowed', function() {
            const plan = plannerWithIntents().plan(baseInput({
                selfCharacters: [character('a', 5, 2), character('b', 3, 4, { ready: false })],
                options: [{ id: 'needs-b', axis: 'military', requiredAttackerUuids: ['b'], bonus: 500 }]
            }));
            expect(plan.optionId).toBeUndefined();
        });

        it('honours declarationIndex so a rule only fires on its own conflict', function() {
            // No opposing declarations, so the opponent cannot deny the ring
            // the second-conflict rule wants — this isolates the index gate.
            const plan = plannerWithIntents().plan(baseInput({
                opponentOpportunities: { total: 0, military: 0, political: 0 },
                options: [{
                    id: 'second-only',
                    axis: 'political',
                    ringElement: 'water',
                    bonus: 500,
                    declarationIndex: 1
                }]
            }));
            expect(plan.optionId).toBeUndefined();
            const selfSteps = plan.sequence.filter((step) => step.actor === 'self');
            expect(selfSteps.length).toBe(2);
            expect(selfSteps[1].optionId).toBe('second-only');
            expect(selfSteps[1].ringElement).toBe('water');
        });

        it('drops generic lines when the profile makes options exclusive', function() {
            const planner = plannerWithIntents({ optionsExclusive: true });
            const plan = planner.plan(baseInput({
                options: [{ id: 'only-political', axis: 'political', ringElement: 'water' }]
            }));
            expect(plan.conflictType).toBe('political');
            expect(plan.optionId).toBe('only-political');
        });

        it('is deterministic for the same board', function() {
            const input = baseInput({
                options: [
                    { id: 'mil', axis: 'military', bonus: 2 },
                    { id: 'pol', axis: 'political', bonus: 2 }
                ]
            });
            const first = plannerWithIntents().plan(input);
            const second = plannerWithIntents().plan(input);
            expect(second.optionId).toBe(first.optionId);
            expect(second.score).toBe(first.score);
            expect(second.attackerUuids).toEqual(first.attackerUuids);
        });
    });
});
