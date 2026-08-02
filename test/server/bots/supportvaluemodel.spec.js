const M = require('../../../build/server/game/bots/v2/CardValueModel.js');

function chr(overrides) {
    return Object.assign({
        uuid: 'u' + Math.random().toString(36).slice(2, 8),
        id: 'generic-body',
        inConflict: false, bowed: false, honored: false, dishonored: false,
        glory: 1, fate: 0, isUnique: false, traits: [],
        military: 2, political: 2, attachments: []
    }, overrides);
}

function ctx(overrides) {
    const base = Object.assign({
        conflictType: 'military', amAttacker: true, activeConflict: true,
        honor: 10, fate: 5, opponentHonor: 10, conflictsRemaining: 1,
        myCharacters: [], opponentCharacters: [], hand: []
    }, overrides);
    if(!base.printedCostByUuid) {
        base.printedCostByUuid = {};
        for(const c of base.myCharacters.concat(base.opponentCharacters, base.dynastyDiscard || [])) {
            if(c.printedCost !== undefined) {
                base.printedCostByUuid[c.uuid] = c.printedCost;
            }
        }
    }
    return base;
}

describe('SupportValueModel', function() {
    describe('stayReadyValue', function() {
        it('is worth more with conflicts left to fight', function() {
            const body = chr({ inConflict: true, military: 4 });
            const none = M.stayReadyValue(body, ctx({ conflictsRemaining: 0 }));
            const some = M.stayReadyValue(body, ctx({ conflictsRemaining: 2 }));
            expect(some).toBeGreaterThan(none);
        });

        it('counts glory extra while the Imperial Favor race is close', function() {
            const body = chr({ inConflict: true, glory: 4 });
            const close = M.stayReadyValue(body, ctx({ myGlory: 5, opponentGlory: 6 }));
            const decided = M.stayReadyValue(body, ctx({ myGlory: 0, opponentGlory: 20 }));
            expect(close).toBeGreaterThan(decided);
        });

        it('is zero for no character', function() {
            expect(M.stayReadyValue(undefined, ctx({}))).toBe(0);
        });
    });

    describe('censure', function() {
        it('is illegal without the Imperial Favor', function() {
            expect(M.censureValue(ctx({ haveImperialFavor: false }), 5).reason).toBe('no-imperial-favor');
        });

        it('cancels while we hold the favor', function() {
            const value = M.censureValue(ctx({ haveImperialFavor: true }), 5);
            expect(value.blocked).toBeFalsy();
            expect(value.abilityValue).toBe(5);
        });
    });

    describe('forgery', function() {
        it('needs us to be LESS honorable than them', function() {
            expect(M.forgeryValue(ctx({ honor: 12, opponentHonor: 8 }), 5).reason).toBe('not-less-honorable');
            expect(M.forgeryValue(ctx({ honor: 4, opponentHonor: 9 }), 5).blocked).toBeFalsy();
        });

        it('needs the 1 fate it costs', function() {
            expect(M.forgeryValue(ctx({ honor: 4, opponentHonor: 9, fate: 0 }), 5).reason)
                .toBe('cannot-pay-1-fate');
        });
    });

    describe('duty', function() {
        it('never holds — it is the difference between losing and not', function() {
            const value = M.dutyValue(ctx({ honor: 1 }), 1);
            expect(value.blocked).toBeFalsy();
            expect(value.abilityValue).toBeGreaterThan(100);
        });

        it('stays out of the way of a survivable honor loss', function() {
            expect(M.dutyValue(ctx({ honor: 9 }), 2).reason).toBe('not-lethal');
        });
    });

    describe('clarity of purpose', function() {
        it('is worth the stay-ready value in a political conflict', function() {
            const value = M.clarityOfPurposeValue(ctx({
                conflictType: 'political', conflictsRemaining: 2,
                myCharacters: [chr({ id: 'tower', inConflict: true, political: 6, glory: 3 })]
            }));
            expect(value.blocked).toBeFalsy();
            expect(value.reason).toContain('stays-ready');
            expect(value.abilityValue).toBeGreaterThan(0);
        });

        it('is worth much less in a military conflict, where the clause does not apply', function() {
            const board = {
                conflictsRemaining: 2,
                myCharacters: [chr({ id: 'tower', inConflict: true, military: 6, political: 6, glory: 3 })]
            };
            const political = M.clarityOfPurposeValue(ctx(Object.assign({ conflictType: 'political' }, board)));
            const military = M.clarityOfPurposeValue(ctx(Object.assign({ conflictType: 'military' }, board)));
            expect(political.abilityValue).toBeGreaterThan(Number(military.abilityValue) || 0);
        });

        it('still pays for bow protection when the opponent can actually bow', function() {
            const value = M.clarityOfPurposeValue(ctx({
                conflictType: 'military', opponentCanBow: true,
                myCharacters: [chr({ inConflict: true, military: 6 })]
            }));
            expect(value.blocked).toBeFalsy();
            expect(value.reason).toContain('bow-proof');
        });
    });

    describe('kakita\'s final stance', function() {
        it('is military only', function() {
            expect(M.kakitasFinalStanceValue(ctx({ conflictType: 'political' })).reason).toBe('military-only');
        });

        it('pays in full once a duel has resolved this conflict', function() {
            const loser = chr({ id: 'them', inConflict: true });
            const board = {
                conflictsRemaining: 2,
                myCharacters: [chr({ id: 'mine', inConflict: true, military: 5, glory: 3 })],
                opponentCharacters: [loser]
            };
            const dueled = M.kakitasFinalStanceValue(ctx(Object.assign({ duelLoserUuids: [loser.uuid] }, board)));
            const notYet = M.kakitasFinalStanceValue(ctx(board));
            expect(dueled.reason).toContain('+dueled');
            expect(dueled.abilityValue).toBeGreaterThan(Number(notYet.abilityValue) || 0);
        });

        it('counts a duel still in hand at a discount', function() {
            const value = M.kakitasFinalStanceValue(ctx({
                conflictsRemaining: 2,
                hand: [{ id: 'duel-to-the-death' }],
                myCharacters: [chr({ inConflict: true, military: 5, glory: 3 })]
            }));
            expect(value.reason).toContain('+duel-in-hand');
        });
    });

    describe('the mountain does not fall', function() {
        it('does nothing on our own attack', function() {
            expect(M.theMountainDoesNotFallValue(ctx({
                amAttacker: true, myCharacters: [chr({ inConflict: true })]
            })).reason).toBe('defenders-only');
        });

        it('keeps our best defender upright', function() {
            const value = M.theMountainDoesNotFallValue(ctx({
                amAttacker: false, conflictsRemaining: 2,
                myCharacters: [chr({ id: 'wall', inConflict: true, military: 6, glory: 2 })]
            }));
            expect(value.blocked).toBeFalsy();
            expect(value.reason).toContain('wall');
        });
    });

    describe('raise the alarm', function() {
        it('is for defenders in a military conflict only', function() {
            expect(M.raiseTheAlarmValue(ctx({ amAttacker: true })).reason).toBe('defenders-only');
            expect(M.raiseTheAlarmValue(ctx({ amAttacker: false, conflictType: 'political' })).reason)
                .toBe('military-only');
        });

        it('is priced at an expected body, since the card is face down', function() {
            const value = M.raiseTheAlarmValue(ctx({ amAttacker: false }));
            expect(value.selfSkill).toBeGreaterThan(0);
            expect(value.blocked).toBeFalsy();
        });
    });

    describe('cavalry reserves', function() {
        it('recruits the best Cavalry it can fit under the cost cap', function() {
            const value = M.cavalryReservesValue(ctx({
                dynastyDiscard: [
                    chr({ id: 'cheap-rider', traits: ['cavalry'], printedCost: 2, military: 4 }),
                    chr({ id: 'huge-rider', traits: ['cavalry'], printedCost: 7, military: 9 }),
                    chr({ id: 'footman', traits: ['bushi'], printedCost: 1, military: 3 })
                ]
            }));
            expect(value.reason).toContain('cheap-rider');
            expect(value.reason).not.toContain('footman');
            expect(value.reason).not.toContain('huge-rider');
            expect(value.selfSkill).toBe(4);
        });

        it('does nothing with no Cavalry in the discard', function() {
            expect(M.cavalryReservesValue(ctx({
                dynastyDiscard: [chr({ traits: ['bushi'], printedCost: 1 })]
            })).reason).toBe('no-cavalry-in-discard');
        });

        it('is military only', function() {
            expect(M.cavalryReservesValue(ctx({ conflictType: 'political' })).reason).toBe('military-only');
        });
    });

    describe('siege warfare', function() {
        it('reports the province reduction, not a skill pump', function() {
            const value = M.siegeWarfareValue(ctx({
                amAttacker: true, haveHolding: true, attackedProvinceStrength: 5
            }));
            expect(value.provinceStrengthDelta).toBe(-2);
            expect(value.selfSkill).toBe(0);
        });

        it('cannot take more strength off than the province has', function() {
            const value = M.siegeWarfareValue(ctx({
                amAttacker: true, haveHolding: true, attackedProvinceStrength: 1
            }));
            expect(value.provinceStrengthDelta).toBe(-1);
        });

        it('needs a holding and needs us to be attacking', function() {
            expect(M.siegeWarfareValue(ctx({ amAttacker: true, haveHolding: false })).reason)
                .toBe('no-holding-in-play');
            expect(M.siegeWarfareValue(ctx({ amAttacker: false, haveHolding: true })).reason)
                .toBe('attackers-only');
        });
    });

    describe('persistence and bearer lifetime', function() {
        // Fate is the survival clock: a body loses 1 fate per fate phase and is
        // discarded at 0, so N fate is roughly N more ROUNDS, each offering a
        // military and a political conflict.
        it('counts the bearer fate, not just the conflicts left this phase', function() {
            const board = ctx({ conflictsRemaining: 1 });
            const bare = M.bearerLifetimeConflicts(chr({ fate: 0 }), board);
            const loaded = M.bearerLifetimeConflicts(chr({ fate: 2 }), board);
            expect(bare).toBe(1);
            expect(loaded).toBe(5);
        });

        it('caps a huge fate pile so one tower cannot dominate scoring', function() {
            expect(M.bearerLifetimeConflicts(chr({ fate: 9 }), ctx({ conflictsRemaining: 2 }))).toBe(6);
        });

        it('still works with no bearer, counting only this phase', function() {
            expect(M.bearerLifetimeConflicts(undefined, ctx({ conflictsRemaining: 2 }))).toBe(2);
        });

        it('is worth far more on a fate-loaded tower than a bare body', function() {
            const board = ctx({ conflictsRemaining: 1 });
            const onTower = M.persistentSkillValue(2, board, chr({ fate: 3 }));
            const onToken = M.persistentSkillValue(2, board, chr({ fate: 0 }));
            expect(onTower).toBeGreaterThan(onToken);
        });

        it('prices a DEBUFF the same way — it persists on the enemy body', function() {
            // Sign-insensitive: a -2 debuff on a 2-fate enemy is worth as much as
            // a +2 buff on a 2-fate ally.
            const board = ctx({ conflictsRemaining: 1 });
            expect(M.persistentSkillValue(-2, board, chr({ fate: 2 })))
                .toBe(M.persistentSkillValue(2, board, chr({ fate: 2 })));
        });

        it('is zero for a bonus of zero', function() {
            expect(M.persistentSkillValue(0, ctx({ conflictsRemaining: 2 }), chr({ fate: 3 }))).toBe(0);
        });
    });

    describe('registry', function() {
        it('models every card in this batch', function() {
            for(const id of ['censure', 'forgery', 'duty', 'clarity-of-purpose',
                'kakita-s-final-stance', 'the-mountain-does-not-fall', 'raise-the-alarm',
                'cavalry-reserves', 'siege-warfare']) {
                expect(M.hasCardValueModel(id)).withContext(id).toBe(true);
            }
        });

        it('keeps the three new cancels out of the hand-play veto', function() {
            for(const id of ['censure', 'forgery', 'duty']) {
                expect(M.REACTION_ONLY_CARDS.has(id)).withContext(id).toBe(true);
            }
        });
    });
});
