'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    BENCHMARK_VERSION,
    STANDARD_OMNISCIENT_GAMES,
    STANDARD_ROUND_ROBIN_GAMES,
    STANDARD_WIN_RATE_GAMES,
    STANDARD_SUITE_ID,
    emptyBenchmark,
    mergeBenchmark,
    omniscientPayload,
    readBenchmark,
    roundRobinPayload,
    winRatesPayload
} = require('../../../tools/selfplay/standardBenchmark.js');

describe('standard self-play benchmark config', function() {
    it('uses 100-game win rates and a 40-game round robin', function() {
        expect(BENCHMARK_VERSION).toBe(6);
        expect(STANDARD_WIN_RATE_GAMES).toBe(100);
        expect(STANDARD_ROUND_ROBIN_GAMES).toBe(40);
        expect(STANDARD_OMNISCIENT_GAMES).toBe(20);
        expect(emptyBenchmark().standard).toEqual(jasmine.objectContaining({
            gamesPerDeck: 100,
            gamesPerMatchup: 40,
            gamesPerOmniscientMatchup: 20
        }));
        expect(emptyBenchmark().engines).toEqual(jasmine.objectContaining({
            v1: jasmine.objectContaining({ engineVersion: 'v1', status: 'default' }),
            v2: jasmine.objectContaining({ engineVersion: 'v2', status: 'experimental' })
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
        expect(mergeBenchmark(third, 3, 'winRates', { generatedAt: 'fourth' }).seeds['3'].label)
            .toBe('board-aware dynasty');

        const v2 = mergeBenchmark(third, 1, 'winRates', {
            generatedAt: 'v2', engineVersion: 'v2', configurationHash: 'v2-hash'
        });
        expect(v2.engines.v2.seeds['1'].winRates.configurationHash).toBe('v2-hash');
        expect(v2.seeds['1'].winRates.generatedAt).toBe('first');
    });

    it('migrates board-aware seed 4 metadata and nested section seeds to 3', function() {
        const file = path.join(os.tmpdir(), `jigoku-benchmark-${process.pid}-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify({
            version: 4,
            seeds: {
                4: {
                    seed: 4,
                    winRates: { challengerSeed: 4, opponentSeed: 4 },
                    roundRobin: { botSeed: 4 }
                }
            }
        }));
        try {
            const migrated = readBenchmark(file).seeds['3'];
            expect(migrated.seed).toBe(3);
            expect(migrated.winRates).toEqual(jasmine.objectContaining({ challengerSeed: 3, opponentSeed: 3 }));
            expect(migrated.roundRobin.botSeed).toBe(3);
        } finally {
            fs.unlinkSync(file);
        }
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
        expect(winRates).toEqual(jasmine.objectContaining({
            engineVersion: 'v1', strategySeed: 1, informationMode: 'fair',
            configurationHash: jasmine.any(String)
        }));
        expect(winRates.totals).toEqual(jasmine.objectContaining({ wins: 55, played: 100 }));
        expect(roundRobin.decks.Lion).toEqual(jasmine.objectContaining({
            wins: 500,
            averageOpponentWinRate: 0.56
        }));
        expect(roundRobin.suiteId).toBe(STANDARD_SUITE_ID);
        expect(roundRobin).toEqual(jasmine.objectContaining({
            engineVersion: 'v1', strategySeed: 1, informationMode: 'fair',
            configurationHash: jasmine.any(String)
        }));

        const omniscient = omniscientPayload({
            generatedAt: 'omni',
            config: { games: 20, seed: 2 },
            totals: { wins: 120, losses: 80, other: 0, played: 200, winRate: 0.6 },
            deckSummaries: [{ deck: 'Lion', wins: 12, losses: 8, other: 0, played: 20, winRate: 0.6 }]
        });
        expect(omniscient.decks.Lion.winRate).toBe(0.6);
        expect(omniscient.botSeed).toBe(2);
        expect(omniscient).toEqual(jasmine.objectContaining({
            engineVersion: 'v1', strategySeed: 2, informationMode: 'omniscient',
            configurationHash: jasmine.any(String)
        }));
    });
});
