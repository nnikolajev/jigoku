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
        expect(DEFAULT_DEFENSE_COMMITMENT.maxSurplusMargin).toBe(0);
        expect(DEFAULT_DEFENSE_COMMITMENT.strongholdMaxSurplusMargin).toBe(0);
        expect(DEFAULT_DEFENSE_COMMITMENT.strongholdCapRequiresEnemyReserve).toBe(false);
    });

    // The surplus caps. These are NOT the defense-sizing family that decides
    // whether to defend — they only trim skill off a defense already decided.
    describe('surplus caps', function() {
        const stronghold = (over = {}) => input(Object.assign({
            strongholdUnderAttack: true,
            potential: 60,
            opponentReadyAtHome: 2
        }, over));

        it('leaves the stronghold uncapped at the default, as V1 does', function() {
            const result = new DefenseCommitmentPolicy({}).size(stronghold());
            expect(result.branch).toBe('stronghold');
            expect(result.target).toBe(Infinity);
            expect(result.surplusCapped).toBe(false);
        });

        // STATIC on purpose: the stronghold's own strength must not shrink the
        // buffer on the province whose break ends the game.
        it('caps the stronghold at attackerSkill + margin, ignoring province strength', function() {
            const weak = new DefenseCommitmentPolicy({ strongholdMaxSurplusMargin: 10 })
                .size(stronghold({ attackerSkill: 7, provinceStrength: 3 }));
            const strong = new DefenseCommitmentPolicy({ strongholdMaxSurplusMargin: 10 })
                .size(stronghold({ attackerSkill: 7, provinceStrength: 9 }));
            expect(weak.target).toBe(17);
            expect(strong.target).toBe(17);
            expect(weak.surplusCapped).toBe(true);
        });

        it('leaves the stronghold uncapped when the attacker kept nothing home', function() {
            const config = { strongholdMaxSurplusMargin: 10, strongholdCapRequiresEnemyReserve: true };
            const noReserve = new DefenseCommitmentPolicy(config)
                .size(stronghold({ opponentReadyAtHome: 0 }));
            const reserve = new DefenseCommitmentPolicy(config)
                .size(stronghold({ opponentReadyAtHome: 1 }));
            expect(noReserve.target).toBe(Infinity);
            expect(reserve.target).toBe(20);
        });

        // Outer provinces measure the margin from the BREAK-PREVENTION line,
        // because the province absorbs its own strength.
        // Reachable only when some other buffer pushed the target out; a
        // `threatBuffer` of 10 is what that looks like.
        it('measures the outer-province cap from attackerSkill - provinceStrength', function() {
            const args = input({ mode: 'prevent-break', attackerSkill: 20, provinceStrength: 4,
                defenderSkill: 0, potential: 60 });
            const uncapped = new DefenseCommitmentPolicy({ threatBuffer: 10 }).size(args);
            const capped = new DefenseCommitmentPolicy({ threatBuffer: 10, maxSurplusMargin: 6 }).size(args);
            expect(uncapped.target).toBe(30);
            // max(20 - 4, 0) + 6
            expect(capped.target).toBe(22);
            expect(capped.surplusCapped).toBe(true);
        });

        // A defense that bows bodies and still LOSES is strictly worse than not
        // defending: it pays the bodies and hands over the ring anyway.
        it('never caps below the point that wins the conflict', function() {
            for(const provinceStrength of [6, 8, 12]) {
                const result = new DefenseCommitmentPolicy({ maxSurplusMargin: 6 })
                    .size(input({ mode: 'win-only', attackerSkill: 25, provinceStrength,
                        defenderSkill: 0, potential: 60 }));
                expect(result.target).toBe(26);
            }
        });

        // V1 already sizes outer provinces minimally, so with no buffer in play
        // there is no surplus for this knob to trim. This is the whole reason
        // the outer-province half of the lever measured as a no-op: the
        // over-commitment seen in real games is BODY GRANULARITY (the biggest
        // ready body is declared first and overshoots a minimal target), which
        // a cap on the target cannot fix.
        it('is inert on outer provinces at the shipped buffers', function() {
            for(const provinceStrength of [3, 4, 5, 6, 7, 8]) {
                for(const attackerSkill of [5, 10, 15, 20, 25, 30]) {
                    const args = input({ mode: 'win-only', attackerSkill, provinceStrength,
                        defenderSkill: 0, potential: 60 });
                    expect(new DefenseCommitmentPolicy({ maxSurplusMargin: 6 }).size(args).target)
                        .toBe(new DefenseCommitmentPolicy({}).size(args).target);
                }
            }
        });
    });
});
