const { GloryTactics, GLORY_DEFAULTS } = require('../../../build/server/game/bots/GloryTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the glory/honor layer (Phoenix For Honor and Glory): strategy
// derivation, profile gating, and the tactic decisions.
describe('GloryTactics', function() {
    const tactics = new GloryTactics(GLORY_DEFAULTS);
    const GLORY = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, glory: true };

    describe('strategy derivation', function() {
        it('flips glory on for the Phoenix stronghold or the marker set', function() {
            expect(deriveDeckStrategy(['isawa-mori-seido']).glory).toBe(true);
            expect(deriveDeckStrategy(['kiku-matsuri', 'court-games', 'censure', 'voice-of-honor']).glory).toBe(true);
        });

        it('stays off for the other piloted decks', function() {
            expect(deriveDeckStrategy(['cavalry-reserves', 'ride-on', 'spoils-of-war', 'curved-blade']).glory).toBe(false);
            expect(deriveDeckStrategy(['city-of-the-open-hand']).glory).toBe(false);
            expect(deriveDeckStrategy([]).glory).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a glory strategy carries the glory knobs; generic attack/defense stays', function() {
            const p = profileFromStrategy(GLORY);
            expect(p.glory).toEqual(GLORY_DEFAULTS);
            expect(p.attackCommitment).toBe('all-but-one');
            expect(p.defenseCommitment).toBe('prevent-break');
            expect(profileFromStrategy({ ...GLORY, glory: false }).glory).toBeUndefined();
        });

        it('parks Rally to the Cause under the stronghold', function() {
            expect(resolveDeckProfile(['rally-to-the-cause', 'isawa-mori-seido'], GLORY).strongholdProvinceId).toBe('rally-to-the-cause');
            expect(resolveDeckProfile(['isawa-mori-seido'], GLORY).strongholdProvinceId).toBeUndefined();
        });
    });

    describe('ring preference', function() {
        it('scores the elements the board exploits', function() {
            const board = [{ id: 'solemn-scholar' }, { id: 'isawa-atsuko' }, { id: 'isawa-ujina' }];
            expect(tactics.ringBonus('earth', board, [])).toBe(GLORY_DEFAULTS.ringCardBonus);
            expect(tactics.ringBonus('void', board, [])).toBe(2 * GLORY_DEFAULTS.ringCardBonus);
            expect(tactics.ringBonus('air', board, [])).toBe(0);
        });

        it('counts Feral Ningyo from hand for the water ring', function() {
            expect(tactics.ringBonus('water', [], [{ id: 'feral-ningyo' }])).toBe(GLORY_DEFAULTS.ringCardBonus);
        });
    });

    describe('decisions', function() {
        it('bids to win duels until honor runs low', function() {
            expect(tactics.desiredDuelBid(10)).toBe(GLORY_DEFAULTS.duelBid);
            expect(tactics.desiredDuelBid(3)).toBe(1);
        });

        it('Ofushikai goes to Shiba Tsukune first', function() {
            const mine = [{ id: 'isawa-kaede' }, { id: 'shiba-tsukune' }];
            expect(tactics.pickOfushikaiTarget(mine).id).toBe('shiba-tsukune');
            expect(tactics.pickOfushikaiTarget([{ id: 'shiba-peacemaker' }])).toBeNull();
        });

        it('glory pump prefers an honored participant, else the biggest ready body', function() {
            const honored = { id: 'a', isHonored: true, inConflict: true, bowed: false };
            const big = { id: 'b', bowed: false };
            expect(tactics.pickGloryTarget([honored, big], () => 0)).toBe(honored);
            expect(tactics.pickGloryTarget([big], () => 0)).toBe(big);
            expect(tactics.pickGloryTarget([], () => 0)).toBeNull();
        });
    });
});
