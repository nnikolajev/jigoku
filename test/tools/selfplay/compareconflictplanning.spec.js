'use strict';

const {
    addDecisionStats,
    markdown,
    parseArgs,
    seededRandom
} = require('../../../tools/selfplay/compareConflictPlanning.js');

describe('compareConflictPlanning CLI', function() {
    it('defaults to every supported seed and accepts deck subsets', function() {
        expect(parseArgs([])).toEqual(jasmine.objectContaining({
            games: 20,
            seeds: [1, 2, 3]
        }));
        const parsed = parseArgs([
            '--games', '12', '--seeds', '2,3', '--decks', 'Lion,Unicorn'
        ]);
        expect(parsed.games).toBe(12);
        expect(parsed.seeds).toEqual([2, 3]);
        expect(parsed.decks).toEqual(['Lion', 'Unicorn']);
    });

    it('rejects removed seeds and unknown decks', function() {
        expect(() => parseArgs(['--seeds', '4'])).toThrowError(
            '--seeds must be a comma-separated subset of 1,2,3'
        );
        expect(() => parseArgs(['--decks', 'Nope'])).toThrowError(/Unknown deck/);
    });

    it('counts planner traces and renders deterministic results', function() {
        const counts = {};
        addDecisionStats(counts, { trace: [
            { reason: 'conflict-lookahead-ring' },
            { reason: 'unrelated' },
            { reason: 'conflict-lookahead-ring' }
        ] });
        expect(counts['conflict-lookahead-ring']).toBe(2);
        const first = seededRandom(7);
        const second = seededRandom(7);
        expect([first(), first()]).toEqual([second(), second()]);
        const text = markdown({
            config: { seeds: [1], games: 2, rngSeed: 7 },
            rows: [{
                seed: 1, deck: 'Lion', lookaheadWins: 2, legacyWins: 0,
                other: 0, lookaheadWinRate: 1,
                lookaheadDecisions: { 'conflict-lookahead-ring': 2 }
            }],
            totals: { lookaheadWins: 2, legacyWins: 0, other: 0, lookaheadWinRate: 1 }
        });
        expect(text).toContain('| 1 | Lion | 2-0 (+0) | 100.0% | 2 |');
        expect(text).toContain('each seat pair shares its starting RNG seed');
    });
});
