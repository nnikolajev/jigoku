'use strict';

const { DECK_LABELS } = require('../../../tools/selfplay/deckRegistry.js');
const { dynastyStats, parseArgs } = require('../../../tools/selfplay/compareDynastySeeds.js');

describe('seed 4 dynasty comparison tool', function() {
    it('defaults to every deck and parses focused deterministic runs', function() {
        expect(parseArgs([])).toEqual(jasmine.objectContaining({
            games: 20, decks: DECK_LABELS, rngSeed: 20260720
        }));
        expect(parseArgs(['--games', '8', '--decks', 'Lion,Unicorn', '--rng-seed', '7']))
            .toEqual(jasmine.objectContaining({ games: 8, decks: ['Lion', 'Unicorn'], rngSeed: 7 }));
        expect(() => parseArgs(['--decks', 'Unknown'])).toThrowError(/Unknown deck/);
    });

    it('summarizes dynasty purchases and additional fate from traces', function() {
        const stats = dynastyStats({ trace: [
            {
                command: 'cardClicked', promptTitle: 'Play cards from provinces',
                reason: 'board-aware-build-board'
            },
            {
                command: 'cardClicked', promptTitle: 'Play cards from provinces',
                reason: 'duel-play-tower'
            },
            {
                command: 'cardClicked', promptTitle: 'Choose a character',
                reason: 'attachment-target'
            },
            { command: 'menuButton', reason: 'fate-aware-additional-fate', target: '1' },
            { command: 'menuButton', reason: 'unrelated' }
        ] });
        expect(stats.purchases).toBe(2);
        expect(stats.additionalFate).toBe(1);
        expect(stats.reasons['board-aware-build-board']).toBe(1);
        expect(stats.reasons['duel-play-tower']).toBe(1);
        expect(stats.reasons['attachment-target']).toBeUndefined();
    });
});
