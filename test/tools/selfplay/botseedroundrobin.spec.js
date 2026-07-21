'use strict';

const {
    buildJobs,
    parseArgs,
    renderMarkdown,
    summarize
} = require('../../../tools/selfplay/botSeedRoundRobin.js');

describe('botSeedRoundRobin', function() {
    it('parses cross-seed options and creates paired chunks', function() {
        const options = parseArgs([
            '--subject-seed', '3', '--opponent-seeds', '1,2', '--games', '4',
            '--chunk-size', '2', '--decks', 'Lion', '--opponents', 'Crab'
        ]);
        const jobs = buildJobs(options);

        expect(jobs.length).toBe(4);
        expect(jobs.map((job) => job.opponentSeed)).toEqual([1, 1, 2, 2]);
        expect(jobs.map((job) => job.startIndex)).toEqual([0, 2, 0, 2]);
    });

    it('summarizes subject wins by deck and opponent seed', function() {
        const options = {
            decks: ['Lion'],
            opponents: ['Crab'],
            opponentSeeds: [1, 2]
        };
        const jobs = [
            {
                deck: 'Lion', opponent: 'Crab', opponentSeed: 1, startIndex: 0,
                results: [{ winner: 'subject', reason: 'conquest' }, { winner: 'opponent', reason: 'dishonor' }]
            },
            {
                deck: 'Lion', opponent: 'Crab', opponentSeed: 2, startIndex: 0,
                results: [{ winner: 'subject', reason: 'conquest' }, { winner: 'subject', reason: 'conquest' }]
            }
        ];

        const report = summarize(options, jobs);

        expect(report.deckSummaries[0]).toEqual(jasmine.objectContaining({
            deck: 'Lion', wins: 3, losses: 1, played: 4, winRate: 0.75
        }));
        expect(report.deckSummaries[0].bySeed['1'].winRate).toBe(0.5);
        expect(report.deckSummaries[0].bySeed['2'].winRate).toBe(1);
    });

    it('renders per-seed columns and gate status', function() {
        const markdown = renderMarkdown({
            config: { subjectSeed: 3, opponentSeeds: [1, 2], opponents: ['Crab'], games: 2, rngSeed: 7 },
            deckSummaries: [{
                deck: 'Lion', wins: 3, losses: 1, other: 0, played: 4, winRate: 0.75,
                bySeed: {
                    1: { wins: 1, losses: 1, other: 0, winRate: 0.5 },
                    2: { wins: 2, losses: 0, other: 0, winRate: 1 }
                }
            }],
            totals: { wins: 3, losses: 1, other: 0, winRate: 0.75 }
        });

        expect(markdown).toContain('| Lion | 3-1 (+0), 75.0% |');
        expect(markdown).toContain('| PASS | 4/4 |');
    });
});
