'use strict';

// Shared deck catalogue for cross-deck self-play tools. Keep labels stable:
// they become player names and report keys.
const {
    loadCrabDeck,
    loadCraneDeck,
    loadCraneDuelDeck,
    loadDragonAttachmentsDeck,
    loadDragonDeck,
    loadLionDeck,
    loadLionDuelistDeck,
    loadPhoenixDeck,
    loadPhoenixPhoenixDeck,
    loadPhoenixShugenjaDeck,
    loadScorpionBidWarDeck,
    loadScorpionDeck,
    loadUnicornDeck,
    loadUnicornRevealDeck
} = require('./deckLoader.js');

const DECK_LOADERS = Object.freeze({
    Crane: loadCraneDeck,
    CraneDuels: loadCraneDuelDeck,
    Crab: loadCrabDeck,
    Dragon: loadDragonDeck,
    DragonAttachments: loadDragonAttachmentsDeck,
    Lion: loadLionDeck,
    LionDuelist: loadLionDuelistDeck,
    Phoenix: loadPhoenixDeck,
    PhoenixPhoenix: loadPhoenixPhoenixDeck,
    PhoenixShugenja: loadPhoenixShugenjaDeck,
    Scorpion: loadScorpionDeck,
    ScorpionBidWar: loadScorpionBidWarDeck,
    Unicorn: loadUnicornDeck,
    UnicornReveal: loadUnicornRevealDeck
});

const DECK_LABELS = Object.freeze(Object.keys(DECK_LOADERS));

function getDeckLoader(label) {
    return DECK_LOADERS[label];
}

module.exports = { DECK_LABELS, DECK_LOADERS, getDeckLoader };
