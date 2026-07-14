const { DragonTactics, DRAGON_DEFAULTS } = require('../../../build/server/game/bots/DragonTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the monk/card-engine layer (Dragon Togashi Mitsu): strategy
// derivation, profile gating, and the tactic decisions.
describe('DragonTactics', function() {
    const tactics = new DragonTactics(DRAGON_DEFAULTS);
    const MONK = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, glory: false, monk: true };

    describe('strategy derivation', function() {
        it('flips monk on for the Dragon stronghold or the Kiho marker set', function() {
            expect(deriveDeckStrategy(['high-house-of-light']).monk).toBe(true);
            expect(deriveDeckStrategy(['togashi-mitsu-2', 'void-fist', 'hurricane-punch', 'swell-of-seafoam']).monk).toBe(true);
        });

        it('stays off for the other piloted decks', function() {
            expect(deriveDeckStrategy(['isawa-mori-seido']).monk).toBe(false);
            expect(deriveDeckStrategy(['cavalry-reserves', 'ride-on', 'spoils-of-war', 'curved-blade']).monk).toBe(false);
            expect(deriveDeckStrategy([]).monk).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a monk strategy carries the dragon knobs; generic attack/defense stays', function() {
            const p = profileFromStrategy(MONK);
            expect(p.dragon).toEqual(DRAGON_DEFAULTS);
            expect(p.attackCommitment).toBe('all-but-one');
            expect(p.defenseCommitment).toBe('prevent-break');
            expect(profileFromStrategy({ ...MONK, monk: false }).dragon).toBeUndefined();
        });

        it('parks Sacred Sanctuary under the stronghold', function() {
            expect(resolveDeckProfile(['sacred-sanctuary', 'high-house-of-light'], MONK).strongholdProvinceId).toBe('sacred-sanctuary');
            expect(resolveDeckProfile(['high-house-of-light'], MONK).strongholdProvinceId).toBeUndefined();
        });
    });

    describe('decisions', function() {
        it('boosts the void ring per Keeper Initiate in the dynasty discard', function() {
            expect(tactics.ringBonus('void', [{ id: 'keeper-initiate' }, { id: 'keeper-initiate' }])).toBe(2 * DRAGON_DEFAULTS.voidRecursionBonus);
            expect(tactics.ringBonus('void', [])).toBe(0);
            expect(tactics.ringBonus('earth', [{ id: 'keeper-initiate' }])).toBe(0);
        });

        it('keeps feeding cards while a payoff character participates', function() {
            expect(tactics.cardEngineParticipating([{ id: 'togashi-mitsu-2', inConflict: true }])).toBe(true);
            expect(tactics.cardEngineParticipating([{ id: 'togashi-mitsu-2', inConflict: false }])).toBe(false);
            expect(tactics.cardEngineParticipating([{ id: 'togashi-initiate', inConflict: true }])).toBe(false);
        });

        it('bids duels until honor runs low', function() {
            expect(tactics.desiredDuelBid(10)).toBe(DRAGON_DEFAULTS.duelBid);
            expect(tactics.desiredDuelBid(3)).toBe(1);
        });

        it('uses the exact live threshold and counts both players for Togashi Ichi', function() {
            expect(tactics.cardTarget([{ id: 'togashi-mitsu-2', inConflict: true }], true)).toBe(5);
            expect(tactics.cardTarget([{ id: 'teacher-of-empty-thought', inConflict: true }], true)).toBe(3);
            expect(tactics.cardTarget([{ id: 'togashi-ichi', inConflict: true }], true)).toBe(10);
            expect(tactics.cardTarget([{ id: 'togashi-ichi', inConflict: true }], true, 2, 3)).toBe(7);
            expect(tactics.cardTarget([{ id: 'togashi-ichi', inConflict: true }], false)).toBe(0);
            expect(tactics.cardTarget([{ id: 'togashi-ichi', inConflict: false }], true)).toBe(0);
            expect(tactics.cardTarget([{ id: 'togashi-initiate', inConflict: true }], true, 0, 0, true)).toBe(5);
            expect(tactics.cardTarget([{ id: 'togashi-ichi', inConflict: true }], true, 0, 0, false, true)).toBe(0);
        });

        it('only fires High House at five and starts a plan only when reachable', function() {
            expect(tactics.strongholdReady(5)).toBe(true);
            expect(tactics.strongholdReady(4)).toBe(false);
            expect(tactics.strongholdReady(1)).toBe(false);
            // cardsPlayed includes Shintao Monastery's virtual card.
            expect(tactics.canReachTarget(1, 4, 5)).toBe(true);
            expect(tactics.canReachTarget(1, 3, 5)).toBe(false);
        });

        it('build-around attachments go to Mitsu first', function() {
            const mine = [{ id: 'togashi-tadakatsu' }, { id: 'togashi-mitsu-2' }];
            expect(tactics.pickKeyCharacter(mine).id).toBe('togashi-mitsu-2');
            expect(tactics.pickKeyCharacter([{ id: 'togashi-initiate' }])).toBeNull();
        });

        it('puts Way of the Dragon only on repeatable high-value abilities', function() {
            const mine = [
                { id: 'togashi-ichi' },
                { id: 'teacher-of-empty-thought' },
                { id: 'togashi-mitsu-2', attachments: [{ id: 'way-of-the-dragon' }] },
                { id: 'tranquil-philosopher' }
            ];
            expect(tactics.pickWayCharacter(mine).id).toBe('tranquil-philosopher');
            expect(tactics.pickWayCharacter([{ id: 'togashi-ichi' }])).toBeNull();
        });

        it('invests fate in towers and preserves them while Cycle digs', function() {
            expect(tactics.desiredAdditionalFate('togashi-mitsu-2', 4)).toBe(4);
            expect(tactics.desiredAdditionalFate('togashi-ichi', 4)).toBe(2);
            expect(tactics.desiredAdditionalFate('teacher-of-empty-thought', 3)).toBe(2);
            expect(tactics.desiredAdditionalFate('togashi-initiate', 1)).toBeNull();
            expect(tactics.shouldPreserveProvinceCharacter({ id: 'kitsuki-investigator' })).toBe(true);
            expect(tactics.shouldPreserveProvinceCharacter({ id: 'togashi-initiate' })).toBe(false);
        });

        it('orders Ancient Master finds for the card-count engine', function() {
            const pick = tactics.pickAncientMasterCard([
                { id: 'iron-foundations-stance' },
                { id: 'void-fist' },
                { id: 'togashi-acolyte' }
            ]);
            expect(pick.id).toBe('togashi-acolyte');
        });
    });
});
