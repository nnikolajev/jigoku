'use strict';

const { DECK_LABELS } = require('../../../tools/selfplay/deckRegistry.js');
const { DECKS } = require('../../../tools/selfplay/winRates.js');

describe('self-play win-rate deck selection', function() {
    it('runs every registered deck except the Crane baseline', function() {
        expect(DECKS).toEqual(DECK_LABELS.filter((label) => label !== 'Crane'));
        expect(DECKS).toContain('DragonAttachments');
        expect(DECKS.length).toBe(9);
    });
});
