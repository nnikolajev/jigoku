const {
    parseArgs,
    seededRandom,
    firstActionDivergence,
    dynastyPlanDiagnostics
} = require('../../../tools/selfplay/analyzePolicyGame.js');

describe('paired policy game analyzer', function() {
    it('parses reusable board targets and policy options', function() {
        const options = parseArgs([
            '--deck', 'PhoenixShugenja',
            '--candidate', 'fate-aware',
            '--late-round', '4',
            '--min-board', '5',
            '--challenger-second'
        ]);

        expect(options.lateRound).toBe(4);
        expect(options.minBoard).toBe(5);
        expect(options.challengerSecond).toBeTrue();
    });

    it('replays the same random stream from the same seed', function() {
        const first = seededRandom(42);
        const second = seededRandom(42);

        expect([first(), first(), first()]).toEqual([second(), second(), second()]);
    });

    it('ignores reason-only changes when finding first action divergence', function() {
        const entry = (target, reason) => ({
            accepted: true,
            decision: { command: 'cardClicked', target, reason }
        });
        const control = { decisions: [entry('A', 'generic'), entry('B', 'generic')] };
        const candidate = { decisions: [entry('A', 'candidate'), entry('C', 'candidate')] };

        const divergence = firstActionDivergence(control, candidate);
        expect(divergence.index).toBe(1);
        expect(divergence.control.decision.target).toBe('B');
        expect(divergence.candidate.decision.target).toBe('C');
    });

    it('flags a card selected as cheap but later recognized as strong', function() {
        const decision = (reason, target) => ({
            accepted: true,
            state: { round: 2, phase: 'dynasty' },
            decision: { reason, target }
        });
        const run = {
            decisions: [
                decision('fate-aware-play-cheap-character', 'Five Cost'),
                decision('fate-aware-additional-fate', '0'),
                decision('fate-aware-pass-after-strong-character', 'Pass')
            ]
        };

        const diagnostics = dynastyPlanDiagnostics(run);
        expect(diagnostics.costHintMismatches.length).toBe(1);
        expect(diagnostics.zeroFundedStrong.length).toBe(1);
        expect(diagnostics.purchases[0].card).toBe('Five Cost');
    });
});
