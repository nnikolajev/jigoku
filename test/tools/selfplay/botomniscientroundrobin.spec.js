'use strict';

const { DECK_LABELS } = require('../../../tools/selfplay/deckRegistry.js');
const {
    buildJobs,
    isStandardRun,
    parseArgs,
    renderMarkdown,
    summarize
} = require('../../../tools/selfplay/botOmniscientRoundRobin.js');

describe('omniscient capability round robin', function() {
    it('takes a strategy seed and defaults to the standardized full pool', function() {
        const options = parseArgs(['2']);
        expect(options).toEqual(jasmine.objectContaining({
            seed: 2,
            games: 20,
            decks: DECK_LABELS,
            opponents: DECK_LABELS
        }));
        expect(parseArgs(['--seed', '3', '--games', '4', '--decks', 'Lion,Unicorn']))
            .toEqual(jasmine.objectContaining({ seed: 3, games: 4, decks: ['Lion', 'Unicorn'] }));
        expect(() => parseArgs(['4'])).toThrowError('seed must be 1, 2, or 3');
    });

    it('builds every ordered cross-pool matchup and summarizes capability wins', function() {
        const options = parseArgs([
            '1', '--games', '2', '--chunk-size', '1',
            '--decks', 'Lion,Unicorn', '--opponents', 'Crane,Crab'
        ]);
        const jobs = buildJobs(options);
        expect(jobs).toHaveSize(8);
        const results = jobs.map((job, index) => ({
            ...job,
            died: null,
            results: [{ winner: index % 2 === 0 ? 'omniscient' : 'default' }]
        }));
        const report = summarize(options, results);
        expect(report.deckSummaries).toHaveSize(2);
        expect(report.totals).toEqual(jasmine.objectContaining({ wins: 4, losses: 4, played: 8, winRate: 0.5 }));
        expect(renderMarkdown({ config: options, ...report })).toContain('50.0% omniscient');
    });

    it('builds only same-deck games for the 60% mirror gate', function() {
        const options = parseArgs([
            '1', '--games', '4', '--chunk-size', '2', '--mirrors-only',
            '--decks', 'Lion,Unicorn', '--opponents', 'Crane,Lion,Unicorn'
        ]);
        const jobs = buildJobs(options);
        expect(jobs).toHaveSize(4);
        expect(jobs.map((job) => [job.deck, job.opponent])).toEqual([
            ['Lion', 'Lion'], ['Lion', 'Lion'], ['Unicorn', 'Unicorn'], ['Unicorn', 'Unicorn']
        ]);
        const report = summarize(options, jobs.map((job) => ({
            ...job,
            died: null,
            results: Array.from({ length: job.games }, () => ({ winner: 'omniscient' }))
        })));
        const markdown = renderMarkdown({ config: options, ...report });
        expect(markdown).toContain('mirror gate');
        expect(markdown).toContain('4-0 (100.0%)');
        expect(markdown).toContain('4/4');
        expect(isStandardRun(options, report)).toBe(false);
    });

    it('publishes only complete standard runs', function() {
        const options = parseArgs(['1']);
        const report = {
            deckSummaries: DECK_LABELS.map((deck) => ({
                deck, played: 20 * DECK_LABELS.length, failedJobs: []
            }))
        };
        expect(isStandardRun(options, report)).toBe(true);
        expect(isStandardRun(parseArgs(['1', '--games', '2']), report)).toBe(false);
        expect(isStandardRun(options, {
            deckSummaries: [{ deck: 'Lion', played: 1, failedJobs: [{ cause: 'incomplete' }] }]
        })).toBe(false);
    });
});
