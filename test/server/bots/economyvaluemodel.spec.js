const M = require('../../../build/server/game/bots/shared/CardValueModel.js');

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
        honor: 10, fate: 5, opponentHonor: 10, opponentFate: 5, conflictsRemaining: 1,
        myCharacters: [], opponentCharacters: [], hand: []
    }, overrides);
    if(!base.printedCostByUuid) {
        base.printedCostByUuid = {};
        for(const c of base.myCharacters.concat(base.opponentCharacters)) {
            if(c.printedCost !== undefined) {
                base.printedCostByUuid[c.uuid] = c.printedCost;
            }
        }
    }
    return base;
}

describe('EconomyValueModel', function() {
    describe('free reactions', function() {
        it('Fruitful Respite is two free fate — always worth firing', function() {
            const value = M.fruitfulRespiteValue();
            expect(value.blocked).toBeFalsy();
            expect(value.abilityValue).toBe(2 * M.FATE_SCORE);
        });

        it('Spoils of War is a net two cards — always worth firing', function() {
            const value = M.spoilsOfWarValue();
            expect(value.blocked).toBeFalsy();
            expect(value.abilityValue).toBeGreaterThan(0);
        });
    });

    describe('the path of man', function() {
        it('pays once the margin reaches 5', function() {
            const value = M.thePathOfManValue(ctx({}), 5);
            expect(value.blocked).toBeFalsy();
            expect(value.abilityValue).toBe(2 * M.FATE_SCORE);
        });

        it('reports how much more margin is needed below 5', function() {
            expect(M.thePathOfManValue(ctx({}), 3).reason).toBe('margin-3-needs-2');
        });

        it('holds rather than blocks below the margin — the play is still legal', function() {
            expect(M.thePathOfManValue(ctx({}), 3).hold).toBe(true);
        });
    });

    describe('guardians of rokugan', function() {
        // The defensive win MARGIN sets both the dig depth and the cost ceiling.
        it('is worth more after a bigger defensive win', function() {
            const small = M.guardiansOfRokuganValue(ctx({ conflictsRemaining: 2 }), 1);
            const big = M.guardiansOfRokuganValue(ctx({ conflictsRemaining: 2 }), 5);
            expect(big.abilityValue).toBeGreaterThan(small.abilityValue);
        });

        it('needs a win margin at all', function() {
            expect(M.guardiansOfRokuganValue(ctx({}), 0).reason).toBe('no-win-margin');
        });

        it('still counts for the Imperial Favor with no conflicts left', function() {
            const value = M.guardiansOfRokuganValue(
                ctx({ conflictsRemaining: 0, myGlory: 4, opponentGlory: 4 }), 3);
            expect(value.blocked).toBeFalsy();
            expect(value.reason).toContain('favor-only');
        });
    });

    describe('for greater glory', function() {
        it('scales with the number of participating Bushi', function() {
            const bushi = (n) => Array.from({ length: n },
                () => chr({ inConflict: true, traits: ['bushi'] }));
            const few = M.forGreaterGloryValue(ctx({ myCharacters: bushi(2) }));
            const many = M.forGreaterGloryValue(ctx({ myCharacters: bushi(5) }));
            expect(many.abilityValue).toBeGreaterThan(few.abilityValue);
        });

        it('breaks even on a single Bushi — it costs a fate to place one', function() {
            const value = M.forGreaterGloryValue(ctx({
                myCharacters: [chr({ inConflict: true, traits: ['bushi'] })]
            }));
            expect(value.hold).toBe(true);
        });

        it('needs a participating Bushi and the fate to pay', function() {
            expect(M.forGreaterGloryValue(ctx({
                myCharacters: [chr({ inConflict: true, traits: ['courtier'] })]
            })).reason).toBe('no-participating-bushi');
            expect(M.forGreaterGloryValue(ctx({
                fate: 0, myCharacters: [chr({ inConflict: true, traits: ['bushi'] })]
            })).reason).toBe('cannot-pay-1-fate');
        });
    });

    describe('feeding an army', function() {
        // Breaking our OWN province is a quarter of the defeat condition, so a
        // wide board of cheap bodies is required before it pays.
        it('holds with only a couple of cheap bodies', function() {
            const value = M.feedingAnArmyValue(ctx({
                myCharacters: [chr({ printedCost: 2 }), chr({ printedCost: 1 })]
            }));
            expect(value.hold).toBe(true);
        });

        it('pays with a wide board of cost-3-or-lower bodies', function() {
            const swarm = Array.from({ length: 8 },
                () => chr({ printedCost: 2, military: 3 }));
            const value = M.feedingAnArmyValue(ctx({ myCharacters: swarm }));
            expect(value.blocked).toBeFalsy();
            expect(value.hold).toBeFalsy();
        });

        it('ignores bodies costing more than 3', function() {
            expect(M.feedingAnArmyValue(ctx({
                myCharacters: [chr({ printedCost: 5 }), chr({ printedCost: 4 })]
            })).reason).toBe('no-cost-3-or-lower-characters');
        });
    });

    describe('levy', function() {
        // The OPPONENT chooses which resource to give, so we get the cheaper —
        // unless one is already empty, which forces the other.
        it('is worth little while they can afford either', function() {
            const value = M.levyValue(ctx({ opponentFate: 8, opponentHonor: 15 }));
            expect(value.abilityValue).toBeLessThan(4);
        });

        it('spikes when their honor is nearly gone', function() {
            const rich = M.levyValue(ctx({ opponentFate: 8, opponentHonor: 15 }));
            const dying = M.levyValue(ctx({ opponentFate: 0, opponentHonor: 2 }));
            expect(dying.abilityValue).toBeGreaterThan(rich.abilityValue);
        });

        it('forces the honor branch when they have no fate', function() {
            const value = M.levyValue(ctx({ opponentFate: 0, opponentHonor: 2 }));
            expect(value.abilityValue).toBe(20);
        });

        it('takes the cheaper of the two when both are healthy', function() {
            const value = M.levyValue(ctx({ opponentFate: 1, opponentHonor: 20 }));
            // Fate at 1 is worth 8 to deny, honor at 20 only 1 — they give honor.
            expect(value.abilityValue).toBe(M.HONOR_SCORE);
        });
    });

    describe('rebuild', function() {
        it('is worth the province strength it GAINS', function() {
            const value = M.rebuildValue(ctx({}), [4, 1], 1);
            expect(value.blocked).toBeFalsy();
            expect(value.reason).toContain('+3-strength');
        });

        it('holds when nothing in the discard beats what is installed', function() {
            expect(M.rebuildValue(ctx({}), [1, 2], 4).hold).toBe(true);
        });

        it('needs a holding in the discard', function() {
            expect(M.rebuildValue(ctx({}), [], 0).reason).toBe('no-holding-in-discard');
        });
    });

    describe('gossip', function() {
        it('forbids a real threat and holds against a weak one', function() {
            expect(M.gossipValue(ctx({}), 20, 13).blocked).toBeFalsy();
            expect(M.gossipValue(ctx({}), 5, 13).hold).toBe(true);
        });

        it('is a conflict-phase card only', function() {
            expect(M.gossipValue(ctx({ activeConflict: false }), 20, 13).reason)
                .toBe('conflict-phase-only');
        });
    });

    describe('registry', function() {
        it('prices every previously unpriced card', function() {
            for(const id of ['levy', 'rebuild', 'gossip', 'fruitful-respite', 'spoils-of-war',
                'the-path-of-man', 'guardians-of-rokugan', 'for-greater-glory',
                'feeding-an-army']) {
                expect(M.hasCardValueModel(id)).withContext(id).toBe(true);
            }
        });

        it('keeps the six economy REACTIONS out of the hand-play veto', function() {
            for(const id of ['fruitful-respite', 'spoils-of-war', 'the-path-of-man',
                'guardians-of-rokugan', 'for-greater-glory', 'feeding-an-army']) {
                expect(M.REACTION_ONLY_CARDS.has(id)).withContext(id).toBe(true);
            }
            // The three Actions have a real choice and must stay plannable.
            for(const id of ['levy', 'rebuild', 'gossip']) {
                expect(M.REACTION_ONLY_CARDS.has(id)).withContext(id).toBe(false);
            }
        });
    });
});
