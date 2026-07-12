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

        it('targets 5 cards normally, 10 only when Togashi Ichi attacks', function() {
            expect(tactics.cardTarget([{ id: 'togashi-mitsu-2', inConflict: true }], true)).toBe(5);
            expect(tactics.cardTarget([{ id: 'togashi-ichi', inConflict: true }], true)).toBe(10);
            expect(tactics.cardTarget([{ id: 'togashi-ichi', inConflict: true }], false)).toBe(5); // defending: no 10-chase
            expect(tactics.cardTarget([{ id: 'togashi-ichi', inConflict: false }], true)).toBe(5);
        });

        it('holds High House of Light for the 5th card only when a ring has fate', function() {
            // Ring fate to steal: wait for the 5th card while reachable.
            expect(tactics.strongholdReady(5, true, true)).toBe(true); // threshold met
            expect(tactics.strongholdReady(3, true, true)).toBe(false); // wait, more cards to play
            expect(tactics.strongholdReady(3, false, true)).toBe(true); // cannot reach 5: use now
            // No ring fate: the 5-card half is useless, activate immediately.
            expect(tactics.strongholdReady(1, true, false)).toBe(true);
        });

        it('build-around attachments go to Mitsu first', function() {
            const mine = [{ id: 'togashi-tadakatsu' }, { id: 'togashi-mitsu-2' }];
            expect(tactics.pickKeyCharacter(mine).id).toBe('togashi-mitsu-2');
            expect(tactics.pickKeyCharacter([{ id: 'togashi-initiate' }])).toBeNull();
        });
    });
});
