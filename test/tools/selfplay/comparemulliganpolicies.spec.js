'use strict';

const {
    markdown,
    parseArgs,
    seededRandom
} = require('../../../tools/selfplay/compareMulliganPolicies.js');

describe('compareMulliganPolicies CLI', function() {
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

    it('has deterministic random streams and renders per-seed results', function() {
        const first = seededRandom(7);
        const second = seededRandom(7);
        expect([first(), first(), first()]).toEqual([second(), second(), second()]);
        const text = markdown({
            config: { seeds: [1, 3], games: 2, rngSeed: 7 },
            rows: [
                { seed: 1, deck: 'Lion', adaptiveWins: 1, legacyWins: 1, other: 0, adaptiveWinRate: 0.5 },
                { seed: 3, deck: 'Lion', adaptiveWins: 2, legacyWins: 0, other: 0, adaptiveWinRate: 1 }
            ],
            totals: { adaptiveWins: 3, legacyWins: 1, other: 0, adaptiveWinRate: 0.75 }
        });
        expect(text).toContain('| 1 | Lion | 1-1 (+0) | 50.0% |');
        expect(text).toContain('| 3 | Lion | 2-0 (+0) | 100.0% |');
    });
});
