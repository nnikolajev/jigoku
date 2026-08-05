'use strict';

const { DECK_LABELS } = require('../../../tools/selfplay/deckRegistry.js');
const { buildJobs, isStandardBenchmarkRun, parseArgs } = require('../../../tools/selfplay/botRoundRobin.js');
const { isDeployableSeed } = require('../../../tools/selfplay/_roundRobinWorker.js');

describe('self-play bot round-robin options', function() {
    // Workers now track the machine: both game budgets are wall clock, so
    // oversubscribing turns slow-but-finishing games into `timeout` non-results.
    it('sizes workers from the core count, accepts board-aware seed 3, and separates omniscience', function() {
        const cores = Math.max(1, require('os').cpus().length - 2);
        expect(parseArgs([])).toEqual(jasmine.objectContaining({
            games: 40, workers: Math.min(24, cores), botSeed: 1, drawBidPolicy: 'adaptive',
            engineVersion: 'v1', v2Mode: 'enabled'
        }));
        expect(parseArgs([]).workers).toBeLessThanOrEqual(cores);
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
            matchups: Array.from({ length: DECK_LABELS.length * (DECK_LABELS.length - 1) / 2 },
                () => ({ played: 40, failedJobs: [] }))
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

    describe('per-deck V2 piloting', function() {
        it('names the decks that pilot V2 and leaves the field on V1', function() {
            expect(parseArgs([]).v2Decks).toEqual([]);
            expect(parseArgs(['--v2-decks', 'Crab']).v2Decks).toEqual(['Crab']);
            expect(parseArgs(['--v2-decks', 'Crab,Lion,Crab']).v2Decks).toEqual(['Crab', 'Lion']);
            expect(() => parseArgs(['--v2-decks', 'Turtle']))
                .toThrowError(/--v2-decks has unknown deck\(s\): Turtle/);
        });

        it('accepts a V2 profile as inline JSON', function() {
            const options = parseArgs(['--v2-profile',
                '{"deckProfile":{"conflictPlanning":{"hopelessAttackKeepHome":3}}}']);
            expect(options.v2Profile.deckProfile.conflictPlanning.hopelessAttackKeepHome).toBe(3);
            expect(() => parseArgs(['--v2-profile', '{nope'])).toThrowError(/not valid JSON/);
        });

        // The whole point of the guard: this run is COMPARED against the stored
        // V1 baseline, so it must never be able to overwrite it.
        it('never publishes a V2-piloted or subject-filtered run as the V1 benchmark', function() {
            const completeReport = {
                matchups: Array.from({ length: DECK_LABELS.length * (DECK_LABELS.length - 1) / 2 },
                () => ({ played: 40, failedJobs: [] }))
            };
            expect(isStandardBenchmarkRun(parseArgs(['--seed', '2']), completeReport)).toBe(true);
            expect(isStandardBenchmarkRun(
                parseArgs(['--seed', '2', '--v2-decks', 'Crab']), completeReport)).toBe(false);
            expect(isStandardBenchmarkRun(
                parseArgs(['--seed', '2', '--v2-profile', '{"deckProfile":{}}']),
                completeReport)).toBe(false);
            expect(isStandardBenchmarkRun(
                parseArgs(['--seed', '2', '--subject', 'Crab']), completeReport)).toBe(false);
        });
    });

    describe('subject filtering', function() {
        it('restricts the run to matchups involving the subject decks', function() {
            expect(parseArgs([]).subjects).toEqual([]);
            expect(parseArgs(['--subject', 'Crab']).subjects).toEqual(['Crab']);
            expect(parseArgs(['--subjects', 'Crab,Lion,Crab']).subjects).toEqual(['Crab', 'Lion']);
            expect(() => parseArgs(['--subject', 'Turtle']))
                .toThrowError(/--subject has unknown deck\(s\): Turtle/);
        });

        // One deck against the full field is DECK_LABELS.length - 1 matchups,
        // not the whole league. The rest are V1-vs-V1 games that cost an hour
        // and answer nothing. Sizes are DERIVED so adding a deck cannot rot them.
        it('schedules only the subject deck\'s matchups', function() {
            const options = parseArgs(['--subject', 'Crab', '--games', '100']);
            const jobs = buildJobs(options.decks, options.games, options.chunkSize, options.subjects);
            const pairs = new Set(jobs.map((job) => `${job.left}|${job.right}`));
            expect(pairs.size).toBe(DECK_LABELS.length - 1);
            for(const pair of pairs) {
                expect(pair.split('|')).toContain('Crab');
            }
            const unfiltered = buildJobs(options.decks, options.games, options.chunkSize, []);
            expect(new Set(unfiltered.map((job) => `${job.left}|${job.right}`)).size)
                .toBe(DECK_LABELS.length * (DECK_LABELS.length - 1) / 2);
        });
    });
});
