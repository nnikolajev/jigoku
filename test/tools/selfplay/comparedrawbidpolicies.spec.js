'use strict';

const {
    markdown,
    parseArgs,
    seededRandom
} = require('../../../tools/selfplay/compareDrawBidPolicies.js');

describe('compareDrawBidPolicies CLI', function() {
    it('parses defaults and deck subsets', function() {
        expect(parseArgs([]).games).toBe(40);
        const parsed = parseArgs(['--games', '12', '--seed', '3', '--decks', 'Lion,Unicorn']);
        expect(parsed.games).toBe(12);
        expect(parsed.seed).toBe(3);
        expect(parsed.decks).toEqual(['Lion', 'Unicorn']);
    });

    it('rejects invalid seeds and decks', function() {
        expect(() => parseArgs(['--seed', '5'])).toThrowError('--seed must be 1..4');
        expect(() => parseArgs(['--decks', 'Nope'])).toThrowError(/Unknown deck/);
    });

    it('has deterministic random streams and renders results', function() {
        const first = seededRandom(7);
        const second = seededRandom(7);
        expect([first(), first(), first()]).toEqual([second(), second(), second()]);
        const text = markdown({
            config: { seed: 1, games: 2, rngSeed: 7 },
            decks: [{ deck: 'Lion', adaptiveWins: 1, legacyWins: 1, other: 0, adaptiveWinRate: 0.5 }],
            totals: { adaptiveWins: 1, legacyWins: 1, other: 0, adaptiveWinRate: 0.5 }
        });
        expect(text).toContain('| Lion | 1-1 (+0) | 50.0% |');
    });
});
