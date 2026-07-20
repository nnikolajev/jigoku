'use strict';

const {
    BENCHMARK_VERSION,
    STANDARD_ROUND_ROBIN_GAMES,
    STANDARD_WIN_RATE_GAMES,
    STANDARD_SUITE_ID,
    emptyBenchmark,
    mergeBenchmark,
    roundRobinPayload,
    winRatesPayload
} = require('../../../tools/selfplay/standardBenchmark.js');

describe('standard self-play benchmark config', function() {
    it('uses 100-game win rates and a 40-game round robin', function() {
        expect(BENCHMARK_VERSION).toBe(4);
        expect(STANDARD_WIN_RATE_GAMES).toBe(100);
        expect(STANDARD_ROUND_ROBIN_GAMES).toBe(40);
        expect(emptyBenchmark().standard).toEqual(jasmine.objectContaining({
            gamesPerDeck: 100,
            gamesPerMatchup: 40
        }));
    });

    it('merges independent script sections without deleting another seed or section', function() {
        const first = mergeBenchmark(emptyBenchmark(), 1, 'winRates', { generatedAt: 'first' });
        const second = mergeBenchmark(first, 1, 'roundRobin', { generatedAt: 'second' });
        const third = mergeBenchmark(second, 2, 'winRates', { generatedAt: 'third' });

        expect(third.seeds['1'].winRates.generatedAt).toBe('first');
        expect(third.seeds['1'].roundRobin.generatedAt).toBe('second');
        expect(third.seeds['2'].winRates.generatedAt).toBe('third');
        expect(third.seeds['2'].label).toBe('old heuristic');
        expect(mergeBenchmark(third, 4, 'winRates', { generatedAt: 'fourth' }).seeds['4'].label)
            .toBe('board-aware dynasty');
    });

    it('stores compact per-deck records for both benchmark types', function() {
        const winRates = winRatesPayload(
            { games: 100, botSeed: 1, craneSeed: 1 },
            [{ label: 'Lion', wins: 55, losses: 44, other: 1, played: 100 }],
            'now'
        );
        const roundRobin = roundRobinPayload({
            generatedAt: 'later',
            config: { games: 40, botSeed: 1 },
            deckSummaries: [{
                deck: 'Lion', wins: 500, losses: 399, other: 1, played: 900,
                overallWinRate: 500 / 899, averageOpponentWinRate: 0.56,
                opponentsCompleted: 9
            }]
        });

        expect(winRates.decks.Lion.winRate).toBe(0.55);
        expect(winRates.suiteId).toBe(STANDARD_SUITE_ID);
        expect(winRates.totals).toEqual(jasmine.objectContaining({ wins: 55, played: 100 }));
        expect(roundRobin.decks.Lion).toEqual(jasmine.objectContaining({
            wins: 500,
            averageOpponentWinRate: 0.56
        }));
        expect(roundRobin.suiteId).toBe(STANDARD_SUITE_ID);
    });
});
