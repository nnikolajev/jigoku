'use strict';

const { DECK_LABELS } = require('../../../tools/selfplay/deckRegistry.js');
const { isStandardBenchmarkRun, parseArgs } = require('../../../tools/selfplay/botRoundRobin.js');

describe('self-play bot round-robin options', function() {
    it('defaults to fate-aware seed 1 and accepts renumbered seed 5', function() {
        expect(parseArgs([])).toEqual(jasmine.objectContaining({ games: 100, botSeed: 1 }));
        expect(parseArgs(['--decks', 'Crane,PhoenixShugenja']).botSeed).toBe(1);

        const options = parseArgs(['--seed', '5', '--decks', 'Crane,PhoenixShugenja']);

        expect(options.botSeed).toBe(5);
        expect(options.decks).toEqual(['Crane', 'PhoenixShugenja']);
        expect(() => parseArgs(['--seed', '6'])).toThrowError('--seed must be a bot mode from 1 to 5');
    });

    it('only publishes a complete 100-game full-deck round robin', function() {
        const options = parseArgs(['--seed', '2']);
        const completeReport = {
            matchups: Array.from({ length: 45 }, () => ({ played: 100, failedJobs: [] }))
        };
        expect(isStandardBenchmarkRun(options, completeReport)).toBe(true);
        expect(isStandardBenchmarkRun(parseArgs(['--seed', '2', '--games', '40']), completeReport)).toBe(false);
        expect(isStandardBenchmarkRun(
            parseArgs(['--seed', '2', '--decks', DECK_LABELS.slice(0, 2).join(',')]),
            completeReport
        )).toBe(false);
        expect(isStandardBenchmarkRun(options, {
            matchups: [{ played: 99, failedJobs: [{ cause: 'incomplete' }] }]
        })).toBe(false);
    });
});
