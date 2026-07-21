'use strict';

const {
    aggregateSummaries,
    buildRetainedProfile,
    evaluateCandidate,
    stableHash,
    summarizeReport,
    validateCoefficients
} = require('../../../tools/selfplay/tuneBotV2.js');
const { allPairs, loadPartitions, validatePartitions } = require('../../../tools/selfplay/v2BenchmarkPartitions.js');

function report(rngSeed, overrides = {}) {
    const rates = overrides.rates || [0.55, 0.5, 0.6];
    return {
        configurationHash: `report-${rngSeed}`,
        config: { rngSeed, seed: 1, mode: 'fair' },
        totals: {
            wins: overrides.wins ?? 11, losses: overrides.losses ?? 9,
            other: overrides.other ?? 0, played: 20,
            meanCandidateMs: overrides.candidateMs ?? 110,
            meanControlMs: 100, fallbackRate: overrides.fallbackRate ?? 0.2,
            budgetExhaustions: overrides.budgetExhaustions ?? 0,
            plannerErrors: overrides.plannerErrors ?? 0
        },
        decks: rates.map((winRate, index) => ({ deck: `d${index}`, winRate }))
    };
}

describe('Bot V2 benchmark partitions and offline tuning', function() {
    it('keeps full-league training and holdout RNG streams disjoint', function() {
        const partitions = loadPartitions();
        expect(validatePartitions(partitions)).toEqual({ valid: true, errors: [] });
        expect(allPairs(partitions.training.decks).length).toBe(45);
        expect(partitions.training.rngSeeds.some((seed) => partitions.holdout.rngSeeds.includes(seed))).toBe(false);
    });

    it('scores stalls, runtime, fallback, variance, outliers, and safety failures as penalties', function() {
        const safe = summarizeReport(report(1));
        const unsafe = summarizeReport(report(2, {
            wins: 8, losses: 10, other: 2, candidateMs: 200,
            fallbackRate: 0.9, rates: [0.1, 0.8, 0.5], budgetExhaustions: 1, plannerErrors: 1
        }));
        expect(aggregateSummaries([safe]).score).toBeGreaterThan(aggregateSummaries([unsafe]).score);
        expect(unsafe.severeDeckOutliers).toBe(1);
        expect(unsafe.stallRate).toBe(0.1);
    });

    it('bounds coefficient deltas and hashes configurations deterministically', function() {
        expect(validateCoefficients({ fate: 1.2 }, { fate: 1 }, { maximumDeltaFromParent: 0.25 }).valid).toBe(true);
        expect(validateCoefficients({ fate: 1.4 }, { fate: 1 }, { maximumDeltaFromParent: 0.25 }).valid).toBe(false);
        expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
    });

    it('requires repeated distinct holdout RNG and no severe deck outliers before default eligibility', function() {
        const partitions = loadPartitions();
        const manifest = {
            parentProfile: { id: 'parent', coefficients: { fate: 1 } },
            bounds: { minimum: 0.75, maximum: 1.25, maximumDeltaFromParent: 0.25 },
            candidates: []
        };
        const candidate = {
            id: 'candidate-a', coefficients: { fate: 1.1 },
            trainingReports: [report(17101)],
            holdoutReports: [report(27101), report(27102)],
            rationale: 'Broad, bounded test profile.'
        };
        const evaluation = evaluateCandidate(candidate, manifest, process.cwd(), partitions);
        expect(evaluation.eligibleForDefault).toBe(true);
        const profile = buildRetainedProfile(evaluation, manifest, partitions, 'fixed-time');
        expect(profile).toEqual(jasmine.objectContaining({
            coefficients: { fate: 1.1 },
            parentProfile: manifest.parentProfile,
            rationale: candidate.rationale,
            eligibleForDefault: true
        }));

        const oneRun = evaluateCandidate({ ...candidate, holdoutReports: [report(27101)] }, manifest, process.cwd(), partitions);
        expect(oneRun.eligibleForDefault).toBe(false);
        expect(oneRun.promotionBlockers).toContain('insufficient-distinct-holdout-rng');

        const outlier = evaluateCandidate({
            ...candidate,
            holdoutReports: [report(27101, { rates: [0.1, 0.8, 0.8] }), report(27102)]
        }, manifest, process.cwd(), partitions);
        expect(outlier.eligibleForDefault).toBe(false);
        expect(outlier.promotionBlockers).toContain('severe-deck-outlier');
    });
});
