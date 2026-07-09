'use strict';

// Builds a Jigoku deck object (the shape game.selectDeck consumes) from an
// EmeraldDB decklist + a card-id -> card-data map. Mirrors the routing in
// jigoku-client lobby.ts buildDeckFromEmeraldDecklistUrl, but self-contained
// and offline: it reads cached fixtures so self-play needs no network.

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');

function loadCards(file) {
    return JSON.parse(fs.readFileSync(file || path.join(FIXTURES, 'unicorn-cards.json'), 'utf8'));
}

function loadDecklist(file) {
    return JSON.parse(fs.readFileSync(file || path.join(FIXTURES, 'unicorn-decklist.json'), 'utf8'));
}

// Route each decklist entry into the bucket Deck.prepare expects. Deck.prepare
// filters again by card.side / card.type, so the routing here only needs to be
// consistent with the card data, not authoritative.
function buildDeck(decklist, cardsById) {
    const deck = {
        name: decklist.name || 'Self-Play Deck',
        faction: { value: decklist.primary_clan || 'neutral' },
        alliance: decklist.secondary_clan ? { value: decklist.secondary_clan } : { name: '', value: '' },
        stronghold: [],
        role: [],
        provinceCards: [],
        conflictCards: [],
        dynastyCards: [],
        outsideTheGameCards: []
    };

    const missing = [];
    for(const [id, count] of Object.entries(decklist.cards || {})) {
        const card = cardsById[id];
        if(!card) {
            missing.push(id);
            continue;
        }
        const entry = { count: count, card: card };
        if(card.type === 'province') {
            deck.provinceCards.push(entry);
        } else if(card.type === 'stronghold') {
            deck.stronghold.push(entry);
        } else if(card.type === 'role') {
            deck.role.push(entry);
        } else if(card.side === 'dynasty') {
            deck.dynastyCards.push(entry);
        } else if(card.side === 'conflict') {
            deck.conflictCards.push(entry);
        } else {
            missing.push(`${id} (unroutable type=${card.type} side=${card.side})`);
        }
    }

    if(missing.length > 0) {
        throw new Error(`Deck build failed, unresolved cards: ${missing.join(', ')}`);
    }
    return deck;
}

// Default: the aggressive Unicorn Cavalry precon from the cached fixtures.
function loadUnicornDeck() {
    return buildDeck(loadDecklist(), loadCards());
}

// Crane Duels (EmeraldDB b59bc6b3) — the deck the human plays against the
// seed-4 omniscient bot. The card fixture is a raw array, so index it by id.
function loadCraneDeck() {
    const decklist = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'crane-decklist.json'), 'utf8'));
    const cardsArray = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'crane-cards.json'), 'utf8'));
    const cardsById = {};
    for(const card of cardsArray) {
        cardsById[card.id] = card;
    }
    return buildDeck(decklist, cardsById);
}

// Crab Defense (EmeraldDB 3a8006b7) — holding-engine / defensive precon.
function loadCrabDeck() {
    const decklist = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'crab-decklist.json'), 'utf8'));
    const cardsArray = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'crab-cards.json'), 'utf8'));
    const cardsById = {};
    for(const card of cardsArray) {
        cardsById[card.id] = card;
    }
    return buildDeck(decklist, cardsById);
}

module.exports = { buildDeck, loadCards, loadDecklist, loadUnicornDeck, loadCraneDeck, loadCrabDeck, FIXTURES };
