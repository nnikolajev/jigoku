'use strict';

const { DECK_LABELS } = require('../../../tools/selfplay/deckRegistry.js');
const { isStandardBenchmarkRun, parseArgs } = require('../../../tools/selfplay/botRoundRobin.js');
const { isDeployableSeed } = require('../../../tools/selfplay/_roundRobinWorker.js');

describe('self-play bot round-robin options', function() {
    it('defaults to 32 workers, accepts board-aware seed 3, and separates omniscience', function() {
        expect(parseArgs([])).toEqual(jasmine.objectContaining({
            games: 40, workers: 32, botSeed: 1, drawBidPolicy: 'adaptive',
            engineVersion: 'v1', v2Mode: 'enabled'
        }));
        expect(parseArgs(['--decks', 'Crane,PhoenixShugenja']).botSeed).toBe(1);

        const options = parseArgs(['--seed', '3', '--decks', 'Crane,PhoenixShugenja']);

        expect(options.botSeed).toBe(3);
        expect(options.decks).toEqual(['Crane', 'PhoenixShugenja']);
        expect(parseArgs(['--omniscient']).omniscient).toBe(true);
        expect(() => parseArgs(['--seed', '4'])).toThrowError('--seed must be a bot mode from 1 to 3');
        expect(parseArgs(['--draw-bid', 'legacy']).drawBidPolicy).toBe('legacy');
        expect(parseArgs(['--engine-version', 'v2', '--v2-mode', 'shadow']))
            .toEqual(jasmine.objectContaining({ engineVersion: 'v2', v2Mode: 'shadow' }));
        expect(() => parseArgs(['--engine-version', 'v3'])).toThrowError(/v1 or v2/);
        expect(() => parseArgs(['--draw-bid', 'random'])).toThrowError('--draw-bid must be adaptive or legacy');
        expect([1, 2, 3].every(isDeployableSeed)).toBe(true);
        expect(isDeployableSeed(4)).toBe(false);
    });

    it('only publishes a complete 40-game full-deck round robin', function() {
        const options = parseArgs(['--seed', '2']);
        const completeReport = {
            matchups: Array.from({ length: 45 }, () => ({ played: 40, failedJobs: [] }))
        };
        expect(isStandardBenchmarkRun(options, completeReport)).toBe(true);
        expect(isStandardBenchmarkRun(parseArgs(['--seed', '2', '--games', '100']), completeReport)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['--seed', '2', '--draw-bid', 'legacy']), completeReport)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['--seed', '2', '--omniscient']), completeReport)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['--seed', '2', '--engine-version', 'v2']), completeReport)).toBe(false);
        expect(isStandardBenchmarkRun(
            parseArgs(['--seed', '2', '--decks', DECK_LABELS.slice(0, 2).join(',')]),
            completeReport
        )).toBe(false);
        expect(isStandardBenchmarkRun(options, {
            matchups: [{ played: 39, failedJobs: [{ cause: 'incomplete' }] }]
        })).toBe(false);
    });
});
