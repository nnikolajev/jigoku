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
    loadPhoenixDeck,
    loadPhoenixShugenjaDeck,
    loadScorpionDeck,
    loadUnicornDeck
} = require('./deckLoader.js');

const DECK_LOADERS = Object.freeze({
    Crane: loadCraneDeck,
    CraneDuels: loadCraneDuelDeck,
    Crab: loadCrabDeck,
    Dragon: loadDragonDeck,
    DragonAttachments: loadDragonAttachmentsDeck,
    Lion: loadLionDeck,
    Phoenix: loadPhoenixDeck,
    PhoenixShugenja: loadPhoenixShugenjaDeck,
    Scorpion: loadScorpionDeck,
    Unicorn: loadUnicornDeck
});

const DECK_LABELS = Object.freeze(Object.keys(DECK_LOADERS));

function getDeckLoader(label) {
    return DECK_LOADERS[label];
}

module.exports = { DECK_LABELS, DECK_LOADERS, getDeckLoader };
