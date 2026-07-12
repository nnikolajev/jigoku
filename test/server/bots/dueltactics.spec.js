const { DuelTactics, DUEL_DEFAULTS } = require('../../../build/server/game/bots/DuelTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the duel layer (upgraded Crane Duels): strategy derivation keyed on
// Tsuma (the sparring Crane precon must stay generic), profile gating, and
// the tactic decisions.
describe('DuelTactics', function() {
    const tactics = new DuelTactics(DUEL_DEFAULTS);
    const DUELIST = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, glory: false, monk: false, duelist: true };

    describe('strategy derivation', function() {
        it('keys on Tsuma so the SPARRING Crane precon stays generic', function() {
            expect(deriveDeckStrategy(['tsuma']).duelist).toBe(true);
            // The old Crane precon has the whole duel package but no Tsuma.
            expect(deriveDeckStrategy(['kyuden-kakita', 'duelist-training', 'kakita-kaezin', 'policy-debate', 'proving-ground']).duelist).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a duelist strategy carries the duel knobs', function() {
            const p = profileFromStrategy(DUELIST);
            expect(p.duelist).toEqual(DUEL_DEFAULTS);
            expect(p.attackCommitment).toBe('all-but-one');
            expect(profileFromStrategy({ ...DUELIST, duelist: false }).duelist).toBeUndefined();
        });

        it('parks Vassal Fields under the stronghold', function() {
            expect(resolveDeckProfile(['tsuma', 'vassal-fields'], DUELIST).strongholdProvinceId).toBe('vassal-fields');
            expect(resolveDeckProfile(['tsuma'], DUELIST).strongholdProvinceId).toBeUndefined();
        });
    });

    describe('decisions', function() {
        it('bids duels to win until honor runs low', function() {
            expect(tactics.desiredDuelBid(10)).toBe(DUEL_DEFAULTS.duelBid);
            expect(tactics.desiredDuelBid(DUEL_DEFAULTS.honorFloor)).toBe(1);
        });

        it('knows each duel source axis', function() {
            expect(tactics.duelAxis('policy-debate')).toBe('political');
            expect(tactics.duelAxis('kakita-dojo')).toBe('military');
            expect(tactics.duelAxis('banzai')).toBeNull();
            expect(tactics.duelAxis(undefined)).toBeNull();
        });

        it('duel attachments stack on the ranked key duelists', function() {
            const mine = [{ id: 'tengu-sensei' }, { id: 'kakita-toshimoko' }];
            expect(tactics.pickKeyCharacter(mine).id).toBe('kakita-toshimoko');
            expect(tactics.pickKeyCharacter([{ id: 'kakita-favorite' }])).toBeNull();
        });
    });
});
