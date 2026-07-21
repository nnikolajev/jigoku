const {
    collectPlannerMetrics,
    firstTraceDifference,
    normalizedTrace,
    parseArgs,
    seededRandom,
    wilson
} = require('../../../tools/selfplay/compareBotVersions.js');

describe('compareBotVersions', function() {
    it('defaults to paired V2 pass-through versus V1 without changing strategy or information dimensions', function() {
        const options = parseArgs([]);
        expect(options).toEqual(jasmine.objectContaining({
            candidateEngine: 'v2', controlEngine: 'v1', v2Mode: 'pass-through',
            seed: 1, mode: 'fair', games: 2, requireEquivalence: false, includeTraces: false
        }));
    });

    it('parses independent engine, seed, mode, deck, and equivalence controls', function() {
        const options = parseArgs([
            '--candidate-engine', 'v2', '--control-engine', 'v1', '--v2-mode', 'shadow',
            '--seed', '3', '--mode', 'omniscient', '--decks', 'Crane,Dragon',
            '--games', '4', '--rng-seed', '77', '--require-equivalence', '--include-traces'
        ]);
        expect(options).toEqual(jasmine.objectContaining({
            candidateEngine: 'v2', controlEngine: 'v1', v2Mode: 'shadow',
            seed: 3, mode: 'omniscient', decks: ['Crane', 'Dragon'], games: 4,
            rngSeed: 77, requireEquivalence: true, includeTraces: true
        }));
        expect(() => parseArgs(['--games', '3'])).toThrowError(/even/);
    });

    it('normalizes transport identities while retaining semantic decisions', function() {
        const first = normalizedTrace([{
            player: 'Candidate', promptTitle: 'Military Fire Conflict Attacker: 4 Defender: 3',
            menuTitle: 'Choose', command: 'cardClicked', args: ['uuid-a'],
            target: 'Akodo', cardId: 'akodo-gunso', reason: 'choose-card', result: 'success', seedState: 4
        }]);
        const second = normalizedTrace([{
            player: 'Candidate', promptTitle: 'Military Fire Conflict Attacker: 8 Defender: 7',
            menuTitle: 'Choose', command: 'cardClicked', args: ['uuid-b'],
            target: 'Akodo', cardId: 'akodo-gunso', reason: 'choose-card', result: 'success', seedState: 4
        }]);
        expect(first).toEqual(second);

        const firstMasked = normalizedTrace([{
            player: 'Candidate', promptTitle: 'Choose a card', command: 'cardClicked',
            args: ['uuid-a'], target: 'uuid-a', cardLocation: 'province 2', reason: 'choose-hidden'
        }]);
        const secondMasked = normalizedTrace([{
            player: 'Candidate', promptTitle: 'Choose a card', command: 'cardClicked',
            args: ['uuid-b'], target: 'uuid-b', cardLocation: 'province 2', reason: 'choose-hidden'
        }]);
        expect(firstMasked).toEqual(secondMasked);
    });

    it('reports the first semantic trace difference without storing complete traces', function() {
        const difference = firstTraceDifference({ Candidate: [{ command: 'menuButton', target: 'Pass' }] }, {
            Candidate: [{ command: 'cardClicked', target: 'Guard' }, { command: 'menuButton', target: 'Pass' }]
        });
        expect(difference).toEqual({
            player: 'Candidate', index: 0, candidateLength: 1, controlLength: 2,
            candidate: { command: 'menuButton', target: 'Pass' },
            control: { command: 'cardClicked', target: 'Guard' }
        });
    });

    it('uses reproducible paired RNG and bounded Wilson intervals', function() {
        const a = seededRandom(91);
        const b = seededRandom(91);
        expect([a(), a(), a()]).toEqual([b(), b(), b()]);
        const interval = wilson(5, 10);
        expect(interval[0]).toBeGreaterThan(0);
        expect(interval[1]).toBeLessThan(1);
    });

    it('collects runtime, search, fallback, churn, and tactical-correction metrics from V2 traces', function() {
        const metrics = collectPlannerMetrics([{
            engineVersion: 'v2', selectedBy: 'fallback', durationMs: 2,
            fallbackReason: 'search-budget-exhausted',
            planner: {
                intentId: 'a', disagreementType: 'v1-preferred', confidence: 0.95, scoreGap: 4,
                budget: { searchedNodes: 10, exhausted: true }
            }
        }, {
            engineVersion: 'v2', selectedBy: 'v2', durationMs: 3,
            planner: {
                intentId: 'b', intentInvalidation: 'opponent-disruption',
                disagreementType: 'proven-v2-improvement', budget: { searchedNodes: 4, exhausted: false }
            }
        }, {
            engineVersion: 'v1', selectedBy: 'v1', durationMs: 99
        }]);
        expect(metrics).toEqual(jasmine.objectContaining({
            decisions: 2, fallbackDecisions: 1, v2Decisions: 1,
            searchedNodes: 14, plannerMs: 5, budgetExhaustions: 1,
            planChurn: 1, tacticalCorrections: 1, thresholdQualifiedPreferences: 1,
            provenDisagreements: 1, v1Preferred: 1
        }));
    });
});
