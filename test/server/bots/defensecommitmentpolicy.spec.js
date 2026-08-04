const {
    DefenseCommitmentPolicy,
    DEFAULT_DEFENSE_COMMITMENT
} = require('../../../build/server/game/bots/DefenseCommitmentPolicy.js');

// `DefenseCommitmentPolicy` is the defense-sizing arithmetic lifted out of
// `JigokuBotPolicy.declareDefenders` so the "does the disabled path still equal
// the old code?" question is a test rather than a diff review. Five separate
// experiments have edited that expression in place.
//
// The rules facts these encode:
//   * a province breaks when attacker skill beats defender skill by at least
//     the province strength, so MATCHING the attacker already saves it;
//   * attackers win ties (`conflict.ts:517`), so matching loses the conflict
//     and the ring anyway;
//   * a defender bows on return home (`conflictflow.ts:950`), so the body that
//     supplies the extra point is gone for the rest of the round whether it
//     contributed 1 skill or 5.
describe('DefenseCommitmentPolicy', function() {
    const input = (over = {}) => Object.assign({
        mode: 'prevent-break',
        attackerSkill: 10,
        defenderSkill: 10,
        potential: 14,
        provinceStrength: 4,
        marginalSkill: 4,
        readyCount: 3,
        conflictsRemaining: 1,
        ringElement: 'fire'
    }, over);

    describe('defaults reproduce V1', function() {
        const policy = new DefenseCommitmentPolicy();

        it('lands exactly on the attacker skill when a tie is reachable', function() {
            const result = policy.size(input());
            expect(result.branch).toBe('tie-or-better');
            expect(result.target).toBe(10);
            expect(result.tieBreakApplied).toBe(false);
        });

        it('reports the window as eligible and declined-because-off', function() {
            const result = policy.size(input());
            expect(result.tieBreakEligible).toBe(true);
            expect(result.tieBreakDeclined).toBe('off');
        });

        it('sizes the prevent-break target one past the break threshold', function() {
            const result = policy.size(input({ attackerSkill: 10, potential: 8 }));
            expect(result.branch).toBe('prevent-break');
            expect(result.target).toBe(7); // 10 - 4 + 1
        });

        it('caps the target at what the board can actually reach', function() {
            const result = policy.size(input({ attackerSkill: 10, potential: 6.5 }));
            expect(result.target).toBe(6.5);
        });

        it('reports hopeless when the province falls whatever we do', function() {
            const result = policy.size(input({ attackerSkill: 10, potential: 5 }));
            expect(result.branch).toBe('hopeless');
            expect(result.target).toBeUndefined();
        });

        it('is not eligible when the best we can do is exactly a tie', function() {
            const result = policy.size(input({ attackerSkill: 10, potential: 10 }));
            expect(result.tieBreakEligible).toBe(false);
            expect(result.target).toBe(10);
        });
    });

    describe('win-only mode', function() {
        const policy = new DefenseCommitmentPolicy();

        it('already adds the tie-breaking point, with the flag off', function() {
            const result = policy.size(input({ mode: 'win-only' }));
            expect(result.branch).toBe('win-only');
            expect(result.target).toBe(11);
        });

        it('concedes rather than saving a province it cannot win', function() {
            const result = policy.size(input({ mode: 'win-only', potential: 10 }));
            expect(result.branch).toBe('concede');
        });
    });

    describe('breakTie', function() {
        it('commits one more skill so the defense wins the conflict', function() {
            const result = new DefenseCommitmentPolicy({ breakTie: true }).size(input());
            expect(result.target).toBe(11);
            expect(result.tieBreakApplied).toBe(true);
            expect(result.tieBreakDeclined).toBeUndefined();
        });

        it('never asks for more than the board can reach', function() {
            const result = new DefenseCommitmentPolicy({ breakTie: true })
                .size(input({ potential: 10.5 }));
            expect(result.target).toBe(10.5);
        });
    });

    describe('breakTieMaxMarginalSkill — price the body, not the point', function() {
        const policy = () => new DefenseCommitmentPolicy({
            breakTie: true,
            breakTieMaxMarginalSkill: 2
        });

        it('declines when the only body left is worth more than the cap', function() {
            const result = policy().size(input({ marginalSkill: 4 }));
            expect(result.tieBreakApplied).toBe(false);
            expect(result.tieBreakDeclined).toBe('marginal-cost');
            expect(result.target).toBe(10);
        });

        it('pays when the marginal body is cheap', function() {
            const result = policy().size(input({ marginalSkill: 2 }));
            expect(result.tieBreakApplied).toBe(true);
            expect(result.target).toBe(11);
        });
    });

    describe('breakTieSurplusBodies — spend a spare body, not a needed one', function() {
        const policy = () => new DefenseCommitmentPolicy({
            breakTie: true,
            breakTieSurplusBodies: 1
        });

        it('declines when the body is needed for a conflict of our own', function() {
            // 2 ready, one goes in, 1 survives; 1 conflict left needs 1 + 1 spare.
            const result = policy().size(input({ readyCount: 2, conflictsRemaining: 1 }));
            expect(result.tieBreakDeclined).toBe('no-surplus');
        });

        it('pays when a spare body remains after the commitment', function() {
            const result = policy().size(input({ readyCount: 3, conflictsRemaining: 1 }));
            expect(result.tieBreakApplied).toBe(true);
        });
    });

    describe('breakTieMinReadyCount — never spend the last body', function() {
        const policy = () => new DefenseCommitmentPolicy({
            breakTie: true,
            breakTieMinReadyCount: 2
        });

        it('declines when the extra point would empty the board', function() {
            const result = policy().size(input({ readyCount: 1 }));
            expect(result.tieBreakApplied).toBe(false);
            expect(result.tieBreakDeclined).toBe('last-body');
            expect(result.target).toBe(10);
        });

        it('pays when a body is still left behind it', function() {
            expect(policy().size(input({ readyCount: 2 })).tieBreakApplied).toBe(true);
        });

        it('is independent of how many conflicts we still have to open', function() {
            // Measured: conflicts-remaining does not separate the good windows
            // from the bad ones; the raw body count does.
            expect(policy().size(input({ readyCount: 1, conflictsRemaining: 0 })).tieBreakDeclined)
                .toBe('last-body');
            expect(policy().size(input({ readyCount: 3, conflictsRemaining: 2 })).tieBreakApplied)
                .toBe(true);
        });
    });

    describe('breakTieRingElements — the ring is the whole prize', function() {
        it('declines a ring the deck does not want', function() {
            const result = new DefenseCommitmentPolicy({
                breakTie: true,
                breakTieRingElements: ['air', 'void']
            }).size(input({ ringElement: 'fire' }));
            expect(result.tieBreakDeclined).toBe('ring');
        });

        it('pays on a listed ring', function() {
            const result = new DefenseCommitmentPolicy({
                breakTie: true,
                breakTieRingElements: ['air', 'void']
            }).size(input({ ringElement: 'air' }));
            expect(result.tieBreakApplied).toBe(true);
        });
    });

    it('ships every knob off', function() {
        expect(DEFAULT_DEFENSE_COMMITMENT.breakTie).toBe(false);
        expect(DEFAULT_DEFENSE_COMMITMENT.breakTieMaxMarginalSkill).toBe(0);
        expect(DEFAULT_DEFENSE_COMMITMENT.breakTieSurplusBodies).toBe(0);
        expect(DEFAULT_DEFENSE_COMMITMENT.breakTieMinReadyCount).toBe(0);
        expect(DEFAULT_DEFENSE_COMMITMENT.breakTieRingElements).toEqual([]);
        expect(DEFAULT_DEFENSE_COMMITMENT.skillBuffer).toBe(0);
        expect(DEFAULT_DEFENSE_COMMITMENT.threatBuffer).toBe(0);
    });
});
