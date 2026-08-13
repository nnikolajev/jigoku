
const {
    planConflictActions,
    DEFAULT_CONFLICT_ACTION_PROFILE
} = require('../../../build/server/game/bots/shared/ConflictActionPlanner.js');

function action(key, overrides) {
    return Object.assign({ key, cost: 0, selfSkill: 0, opponentSkill: 0 }, overrides);
}

function attack(overrides) {
    return Object.assign({
        amAttacker: true,
        attackerSkill: 5,
        defenderSkill: 3,
        provinceStrength: 4,
        fate: 5,
        honor: 10,
        actions: []
    }, overrides);
}

describe('ConflictActionPlanner', function() {
    describe('province strength reduction', function() {
        // Breaking needs `lead >= strength`, so taking strength off the province
        // is worth exactly as much as adding skill - but it is not skill, and
        // must not change who WINS the conflict. Siege Warfare.
        it('breaks a province it could not out-skill, by lowering it', function() {
            const plan = planConflictActions(attack({
                attackerSkill: 5, defenderSkill: 3, provinceStrength: 4,
                actions: [action('siege', { cardId: 'siege-warfare', cost: 0, provinceStrengthDelta: -2 })]
            }));
            expect(plan).not.toBeNull();
            expect(plan.breaks).toBe(true);
            expect(plan.actions.map((entry) => entry.cardId)).toEqual(['siege-warfare']);
        });

        it('cannot take a province below 0 strength', function() {
            const plan = planConflictActions(attack({
                attackerSkill: 1, defenderSkill: 0, provinceStrength: 1,
                actions: [action('siege', { cardId: 'siege-warfare', cost: 0, provinceStrengthDelta: -5 })]
            }));
            // Lead 1 against an effective strength of 0 still breaks, and the
            // clamp must not turn the surplus into a negative threshold.
            expect(plan === null || plan.breaks).toBeTruthy();
        });

        it('gives the DEFENDER nothing — only an attacker can besiege', function() {
            const plan = planConflictActions(attack({
                amAttacker: false, attackerSkill: 9, defenderSkill: 2, provinceStrength: 4,
                actions: [action('siege', { cardId: 'siege-warfare', cost: 0, provinceStrengthDelta: -4 })]
            }));
            expect(plan === null || plan.breaks === true).toBeTruthy();
        });
    });

    describe('abilityValue is clamped', function() {
        // `abilityValue` comes from hand-written per-card models. One mis-scaled
        // entry must not be able to outweigh a province break: Duty reports 1000
        // in its own reaction path, and unclamped it dominated every plan.
        it('cannot outweigh a province break', function() {
            const plan = planConflictActions(attack({
                provinceStrength: 5, attackerSkill: 5, defenderSkill: 3, fate: 5,
                actions: [
                    action('runaway', { cardId: 'duty', cost: 1, abilityValue: 100000 }),
                    action('pump', { cardId: 'fine-katana', cost: 0, selfSkill: 3 })
                ]
            }));
            expect(plan).not.toBeNull();
            // The pump reaches lead 5 and breaks; the huge ability score must not
            // crowd it out of the chosen plan.
            expect(plan.actions.map((entry) => entry.cardId)).toContain('fine-katana');
        });
    });

    describe('persistent value', function() {
        // An attachment pays its bonus in every conflict it survives into; an
        // event pays once. Scoring only the current conflict made the planner
        // trade Fine Katana for Banzai — 349 of 410 divergences from V1 were
        // this shape.
        const withPersistence = Object.assign({}, DEFAULT_CONFLICT_ACTION_PROFILE,
            { persistentWeight: 1 });

        it('prefers a smaller attachment over a bigger one-shot event', function() {
            const plan = planConflictActions(attack({
                provinceStrength: 9, attackerSkill: 3, defenderSkill: 3, fate: 5,
                actions: [
                    action('katana', { cardId: 'fine-katana', cost: 0, selfSkill: 2, persistentValue: 4 }),
                    action('banzai', { cardId: 'banzai', cost: 0, selfSkill: 3 })
                ]
            }), withPersistence);
            expect(plan).not.toBeNull();
            expect(plan.actions.map((entry) => entry.cardId)).toContain('fine-katana');
        });

        it('still takes the event when it is the play that BREAKS', function() {
            // Lead 2 against strength 5: banzai's +3 breaks, the katana's +2 does
            // not. A break outranks any amount of persistence.
            const plan = planConflictActions(attack({
                provinceStrength: 5, attackerSkill: 5, defenderSkill: 3, fate: 5,
                actions: [
                    action('katana', { cardId: 'fine-katana', cost: 0, selfSkill: 2, persistentValue: 40 }),
                    action('banzai', { cardId: 'banzai', cost: 0, selfSkill: 3 })
                ]
            }), withPersistence);
            expect(plan).not.toBeNull();
            expect(plan.breaks).toBe(true);
        });

        it('persistence is not skill — it cannot win the conflict on its own', function() {
            // Defender behind by 4 with only a persistent card available: the
            // conflict is still lost, so `wins` must stay false.
            const plan = planConflictActions(attack({
                amAttacker: false, attackerSkill: 9, defenderSkill: 1, provinceStrength: 9,
                actions: [action('fan', { cardId: 'ornate-fan', cost: 0, selfSkill: 0, persistentValue: 30 })]
            }), withPersistence);
            expect(plan === null || plan.wins === false).toBeTruthy();
        });

        it('persistentWeight 0 restores current-conflict-only scoring', function() {
            const board = {
                provinceStrength: 9, attackerSkill: 3, defenderSkill: 3, fate: 5,
                actions: [
                    action('katana', { cardId: 'fine-katana', cost: 0, selfSkill: 2, persistentValue: 4 }),
                    action('banzai', { cardId: 'banzai', cost: 0, selfSkill: 3 })
                ]
            };
            const off = planConflictActions(attack(board),
                Object.assign({}, DEFAULT_CONFLICT_ACTION_PROFILE, { persistentWeight: 0 }));
            expect(off.actions.map((entry) => entry.cardId)).toContain('banzai');
        });
    });

    describe('reaching the break threshold', function() {
        it('combines two pumps that only clear the threshold together', function() {
            // Lead is 2 against a strength-5 province: +2 alone reaches lead 4
            // and breaks nothing, both together reach 6 and break.
            const plan = planConflictActions(attack({
                provinceStrength: 5,
                actions: [
                    action('katana', { cardId: 'fine-katana', cost: 0, selfSkill: 2 }),
                    action('shukujo', { cardId: 'shukujo', cost: 2, selfSkill: 2 })
                ]
            }));
            expect(plan).not.toBeNull();
            expect(plan.breaks).toBe(true);
            expect(plan.actions.map((entry) => entry.cardId).sort())
                .toEqual(['fine-katana', 'shukujo']);
        });

        it('spends nothing when the province already breaks', function() {
            const plan = planConflictActions(attack({
                attackerSkill: 9, defenderSkill: 3,
                actions: [action('katana', { cardId: 'fine-katana', cost: 0, selfSkill: 2 })]
            }));
            expect(plan).toBeNull();
        });

        it('takes the cheaper of two plans that both break', function() {
            const plan = planConflictActions(attack({
                attackerSkill: 5, defenderSkill: 3, provinceStrength: 3,
                actions: [
                    action('cheap', { cardId: 'cheap', cost: 1, selfSkill: 2 }),
                    action('dear', { cardId: 'dear', cost: 4, selfSkill: 4 })
                ]
            }));
            expect(plan.actions.map((entry) => entry.cardId)).toEqual(['cheap']);
        });

        it('never plans a spend above the fate budget', function() {
            const plan = planConflictActions(attack({
                fate: 2,
                actions: [
                    action('a', { cardId: 'a', cost: 2, selfSkill: 2 }),
                    action('b', { cardId: 'b', cost: 2, selfSkill: 2 })
                ]
            }));
            expect(plan === null || plan.actions.reduce((sum, e) => sum + e.cost, 0) <= 2).toBe(true);
        });
    });

    describe('deck preferences are weights, not vetoes', function() {
        it('keeps the deck-endorsed card when both plans break', function() {
            const plan = planConflictActions(attack({
                attackerSkill: 5, defenderSkill: 3, provinceStrength: 4,
                actions: [
                    action('endorsed', { cardId: 'endorsed', cost: 0, selfSkill: 2, deckPreference: 0 }),
                    action('vetoed', { cardId: 'vetoed', cost: 0, selfSkill: 2, deckPreference: -30, relaxed: true })
                ]
            }));
            expect(plan.actions[0].cardId).toBe('endorsed');
        });

        it('overrules the deck veto when only the vetoed card breaks', function() {
            // The endorsed card cannot reach the threshold; the vetoed one can.
            const plan = planConflictActions(attack({
                attackerSkill: 5, defenderSkill: 3, provinceStrength: 4,
                actions: [
                    action('endorsed', { cardId: 'endorsed', cost: 0, selfSkill: 1, deckPreference: 0 }),
                    action('vetoed', { cardId: 'vetoed', cost: 0, selfSkill: 3, deckPreference: -30, relaxed: true })
                ]
            }));
            expect(plan.breaks).toBe(true);
            expect(plan.actions.map((entry) => entry.cardId)).toContain('vetoed');
        });

        it('respects the deck veto when the vetoed card changes no outcome', function() {
            // Nothing here breaks or wins, so the veto penalty is decisive.
            const plan = planConflictActions(attack({
                attackerSkill: 0, defenderSkill: 20, provinceStrength: 5,
                actions: [action('vetoed', { cardId: 'vetoed', cost: 1, selfSkill: 2, deckPreference: -30, relaxed: true })]
            }));
            expect(plan).toBeNull();
        });
    });

    describe('conflict rules', function() {
        it('treats a tie as an attacker win when the attacker has skill', function() {
            const plan = planConflictActions(attack({
                attackerSkill: 2, defenderSkill: 4, provinceStrength: 9,
                actions: [action('pump', { cardId: 'pump', cost: 0, selfSkill: 2 })]
            }));
            expect(plan).not.toBeNull();
            expect(plan.wins).toBe(true);
        });

        it('does not award a 0-0 conflict to the attacker', function() {
            const plan = planConflictActions(attack({
                attackerSkill: 0, defenderSkill: 0, provinceStrength: 9,
                actions: [action('noop', { cardId: 'noop', cost: 0, selfSkill: 0, abilityValue: 1 })]
            }));
            expect(plan === null || plan.wins === false).toBe(true);
        });

        it('scores removing enemy skill the same as adding our own', function() {
            const removal = planConflictActions(attack({
                attackerSkill: 5, defenderSkill: 3, provinceStrength: 4,
                actions: [action('assassin', { cardId: 'assassin', cost: 0, selfSkill: 0, opponentSkill: -2 })]
            }));
            expect(removal).not.toBeNull();
            expect(removal.breaks).toBe(true);
        });
    });

    describe('defending', function() {
        it('spends to deny a break it can actually prevent', function() {
            // Attacker leads by 4 into a strength-4 province: 1 skill saves it.
            const plan = planConflictActions({
                amAttacker: false,
                attackerSkill: 7, defenderSkill: 3, provinceStrength: 4,
                fate: 3, honor: 10,
                actions: [action('guard', { cardId: 'guard', cost: 1, selfSkill: 2 })]
            });
            expect(plan).not.toBeNull();
            expect(plan.breaks).toBe(false);
        });

        it('keeps its cards when the province falls either way', function() {
            const plan = planConflictActions({
                amAttacker: false,
                attackerSkill: 20, defenderSkill: 0, provinceStrength: 4,
                fate: 3, honor: 10,
                actions: [action('guard', { cardId: 'guard', cost: 1, selfSkill: 2 })]
            });
            expect(plan).toBeNull();
        });

        it('spends everything to save the stronghold', function() {
            // Identical board to the fold above, but losing here loses the game.
            const plan = planConflictActions({
                amAttacker: false,
                attackerSkill: 9, defenderSkill: 0, provinceStrength: 4,
                fate: 6, honor: 10, strongholdConflict: true,
                actions: [
                    action('a', { cardId: 'a', cost: 2, selfSkill: 3 }),
                    action('b', { cardId: 'b', cost: 2, selfSkill: 3 })
                ]
            });
            expect(plan).not.toBeNull();
            expect(plan.breaks).toBe(false);
            expect(plan.actions.length).toBe(2);
        });
    });

    describe('honor costs', function() {
        it('pays honor freely with honor to spare', function() {
            const plan = planConflictActions(attack({
                honor: 11, attackerSkill: 5, defenderSkill: 3, provinceStrength: 4,
                actions: [action('duel', { cardId: 'duel', cost: 0, honorCost: 1, selfSkill: 2 })]
            }));
            expect(plan).not.toBeNull();
            expect(plan.breaks).toBe(true);
        });

        it('refuses an ordinary honor cost that would end the game', function() {
            const plan = planConflictActions(attack({
                honor: 1, attackerSkill: 5, defenderSkill: 3, provinceStrength: 9,
                actions: [action('duel', { cardId: 'duel', cost: 0, honorCost: 1, selfSkill: 2 })]
            }));
            expect(plan).toBeNull();
        });
    });

    describe('guards', function() {
        it('returns null when disabled', function() {
            const plan = planConflictActions(attack({
                actions: [action('a', { cardId: 'a', cost: 0, selfSkill: 5 })]
            }), Object.assign({}, DEFAULT_CONFLICT_ACTION_PROFILE, { enabled: false }));
            expect(plan).toBeNull();
        });

        it('returns null with no candidates', function() {
            expect(planConflictActions(attack({ actions: [] }))).toBeNull();
        });

        it('is deterministic across repeated identical calls', function() {
            const input = attack({
                actions: [
                    action('a', { cardId: 'a', cost: 1, selfSkill: 2 }),
                    action('b', { cardId: 'b', cost: 1, selfSkill: 2 }),
                    action('c', { cardId: 'c', cost: 1, selfSkill: 2 })
                ]
            });
            const first = planConflictActions(input);
            for(let i = 0; i < 5; i++) {
                expect(planConflictActions(input).actions.map((e) => e.key))
                    .toEqual(first.actions.map((e) => e.key));
            }
        });
    });
});
