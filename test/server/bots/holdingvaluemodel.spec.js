const M = require('../../../build/server/game/bots/v2/CardValueModel.js');

function holding(id, strengthBonus, provinceBroken = false) {
    return { id, strengthBonus, provinceBroken };
}

function chr(overrides) {
    return Object.assign({
        uuid: 'u1', id: 'kaiu-siege-force', bowed: true, inConflict: false,
        honored: false, dishonored: false, glory: 1, fate: 0, isUnique: false,
        traits: [], military: 7, political: 2, attachments: []
    }, overrides);
}

function ctx(overrides) {
    return Object.assign({
        conflictType: 'military', amAttacker: true, activeConflict: true,
        honor: 10, fate: 5, conflictsRemaining: 2, myGlory: 4, opponentGlory: 4,
        myCharacters: [chr({})], opponentCharacters: [], hand: [],
        playHoldings: [holding('watchtower-of-valor', 1)]
    }, overrides);
}

describe('HoldingValueModel', function() {
    describe('holdingValue', function() {
        it('prices province strength above raw skill — it persists all game', function() {
            expect(M.PROVINCE_STRENGTH_SCORE).toBeGreaterThan(1);
            expect(M.holdingValue(holding('watchtower-of-valor', 1)))
                .toBe(M.PROVINCE_STRENGTH_SCORE + M.HOLDING_ABILITY_VALUE['watchtower-of-valor']);
        });

        it('writes off the strength of a holding behind a BROKEN province', function() {
            const live = M.holdingValue(holding('kaiu-forges', 3, false));
            const spent = M.holdingValue(holding('kaiu-forges', 3, true));
            expect(spent).toBeLessThan(live);
            // Only the ability survives; the province cannot be broken twice.
            expect(spent).toBe(M.HOLDING_ABILITY_VALUE['kaiu-forges']);
        });

        it('still values a +0-strength holding for its text', function() {
            expect(M.holdingValue(holding('river-of-the-last-stand', 0))).toBeGreaterThan(0);
        });

        it('falls back to a default for an uncurated holding', function() {
            expect(M.holdingValue(holding('unknown-holding', 0)))
                .toBe(M.DEFAULT_HOLDING_ABILITY_VALUE);
        });
    });

    describe('cheapestHolding', function() {
        // Every card that spends a holding lets us choose, so the price of the
        // effect is the cheapest one on the board.
        it('picks the least valuable holding, not the first', function() {
            const picked = M.cheapestHolding(ctx({
                playHoldings: [
                    holding('northern-curtain-wall', 4),
                    holding('watchtower-of-valor', 1)
                ]
            }));
            expect(picked.holding.id).toBe('watchtower-of-valor');
        });

        it('prefers a holding behind a broken province over a weaker live one', function() {
            const picked = M.cheapestHolding(ctx({
                playHoldings: [
                    holding('watchtower-of-valor', 1, false),
                    holding('third-whisker-warrens', 1, true)
                ]
            }));
            expect(picked.holding.id).toBe('third-whisker-warrens');
        });

        it('returns null with no holdings in play', function() {
            expect(M.cheapestHolding(ctx({ playHoldings: [] }))).toBeNull();
        });
    });

    describe('kaiu siege force', function() {
        it('fires to unbow a big body when the cheapest holding is spent', function() {
            const value = M.kaiuSiegeForceValue(ctx({
                playHoldings: [holding('watchtower-of-valor', 1, true)]
            }));
            expect(value.blocked).toBeFalsy();
            expect(value.hold).toBeFalsy();
            expect(value.abilityValue).toBeGreaterThan(0);
            expect(value.reason).toContain('broken-province');
        });

        it('holds rather than bottom a load-bearing wall', function() {
            const value = M.kaiuSiegeForceValue(ctx({
                playHoldings: [holding('northern-curtain-wall', 4)]
            }));
            expect(value.hold).toBe(true);
        });

        it('is worth nothing while the character is already ready', function() {
            expect(M.kaiuSiegeForceValue(ctx({
                myCharacters: [chr({ bowed: false })]
            })).reason).toBe('already-ready');
        });

        it('needs a holding to spend and the character in play', function() {
            expect(M.kaiuSiegeForceValue(ctx({ playHoldings: [] })).reason)
                .toBe('no-friendly-holding');
            expect(M.kaiuSiegeForceValue(ctx({ myCharacters: [] })).reason)
                .toBe('not-in-play');
        });

        it('is worth more with more conflicts left to reuse the body in', function() {
            const late = M.kaiuSiegeForceValue(ctx({
                conflictsRemaining: 0, playHoldings: [holding('watchtower-of-valor', 1, true)]
            }));
            const early = M.kaiuSiegeForceValue(ctx({
                conflictsRemaining: 2, playHoldings: [holding('watchtower-of-valor', 1, true)]
            }));
            const lateValue = late.hold ? 0 : late.abilityValue;
            expect(early.abilityValue).toBeGreaterThan(lateValue);
        });
    });

    describe('registry', function() {
        it('prices kaiu-siege-force and keeps it out of the hand-play veto', function() {
            expect(M.hasCardValueModel('kaiu-siege-force')).toBe(true);
            expect(M.REACTION_ONLY_CARDS.has('kaiu-siege-force')).toBe(false);
        });
    });
});
