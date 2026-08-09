const {
    SaveFatePassPolicy,
    DEFAULT_SAVE_FATE_PASS
} = require('../../../build/server/game/bots/SaveFatePassPolicy.js');
const {
    DEFAULT_PROFILE,
    profileFromStrategy
} = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the early-round fate floor: in `setupRounds`, every character bought
// gets at least `setupAdditionalFate` extra fate, so it survives the fate
// phase of the round that bought it (`FatePhase` discards no-fate characters
// at step 4.2, before 4.3 removes a fate).
//
// Shipped field-wide in two measured steps, each on six shuffle bases never
// used to find it: +2.22pp (p=0.011) for round one, then +4.14pp (p<0.0001)
// for extending to rounds 1-3. See `docs/bot-fate-starvation.md`.
describe('SaveFatePassPolicy (early-round fate floor)', function() {
    describe('off unless a deck opts in', function() {
        it('is inert with the bare defaults', function() {
            expect(new SaveFatePassPolicy().inert).toBe(true);
            expect(DEFAULT_SAVE_FATE_PASS.setupRounds).toEqual([]);
        });

        it('is inert when the floor is zero, whatever rounds are named', function() {
            const policy = new SaveFatePassPolicy({ setupRounds: [1, 2, 3], setupAdditionalFate: 0 });
            expect(policy.inert).toBe(true);
            expect(policy.setupFateFloor(1)).toBe(0);
        });

        it('goes live once a round is named', function() {
            expect(new SaveFatePassPolicy({ setupRounds: [1] }).inert).toBe(false);
        });
    });

    describe('the floor', function() {
        const policy = new SaveFatePassPolicy({ setupRounds: [1, 2, 3], setupAdditionalFate: 1 });

        it('applies to exactly the named rounds', function() {
            expect([1, 2, 3].map((round) => policy.setupFateFloor(round))).toEqual([1, 1, 1]);
            expect(policy.setupFateFloor(4)).toBe(0);
            expect(policy.setupFateFloor(0)).toBe(0);
        });

        it('carries its own size', function() {
            expect(new SaveFatePassPolicy({ setupRounds: [1], setupAdditionalFate: 3 })
                .setupFateFloor(1)).toBe(3);
        });

        it('fills unnamed fields from the defaults', function() {
            expect(new SaveFatePassPolicy({ setupRounds: [1] }).profile.setupAdditionalFate)
                .toBe(DEFAULT_SAVE_FATE_PASS.setupAdditionalFate);
        });
    });

    describe('what ships', function() {
        // The DURATION is the lever, not the amount: extending past round 3
        // measured +0.80pp (p=0.36) and raising the floor to 2 measured
        // +0.69pp (p=0.45). Both were rejected.
        it('ships rounds 1-3 at a floor of one, field-wide', function() {
            expect(DEFAULT_PROFILE.saveFatePass.setupRounds).toEqual([1, 2, 3]);
            expect(DEFAULT_PROFILE.saveFatePass.setupAdditionalFate).toBe(1);
        });

        it('reaches every deck through the resolved profile', function() {
            const policy = new SaveFatePassPolicy(profileFromStrategy().saveFatePass);
            expect(policy.inert).toBe(false);
            expect(policy.setupFateFloor(2)).toBe(1);
            expect(policy.setupFateFloor(4)).toBe(0);
        });

        // A bare spread would hand every deck the SAME array, so one deck
        // override would leak into all seventeen.
        it('clones its rounds array per deck', function() {
            const a = profileFromStrategy();
            const b = profileFromStrategy();
            expect(a.saveFatePass).not.toBe(b.saveFatePass);
            expect(a.saveFatePass.setupRounds).not.toBe(b.saveFatePass.setupRounds);
        });
    });
});
