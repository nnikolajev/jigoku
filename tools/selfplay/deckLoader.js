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

// Load a deck by fixture slug: the decklist plus every card fixture the list
// needs, indexed by id.
function loadBySlug(slug, cardFiles) {
    const decklist = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${slug}-decklist.json`), 'utf8'));
    return buildDeck(decklist, indexFixtureCards(cardFiles));
}

// Default: the aggressive Unicorn Cavalry precon from the cached fixtures.
function loadUnicornDeck() {
    return loadBySlug('unicorn', ['unicorn-cards.json']);
}

// Unicorn Reveal (EmeraldDB 6057d28e) -- Shiro Shinjo economy, province
// reveal/redirect effects, and a late Scouted Terrain stronghold attack.
function loadUnicornRevealDeck() {
    return loadBySlug('unicorn-reveal', ['unicorn-reveal-cards.json']);
}

// Crane Baseline (EmeraldDB 4736f7c0) — the standard win-rate opponent and
// a playable bot deck. Card fixtures are raw arrays, so index them by id.
function indexFixtureCards(fileNames) {
    const cardsById = {};
    for(const fileName of fileNames) {
        const parsed = JSON.parse(fs.readFileSync(path.join(FIXTURES, fileName), 'utf8'));
        // The oldest fixtures are already id-keyed maps; the importer writes
        // arrays. Accept both so one loader path covers every deck.
        const cards = Array.isArray(parsed) ? parsed : Object.values(parsed);
        for(const card of cards) {
            cardsById[card.id] = card;
        }
    }
    return cardsById;
}

function loadCraneDeck() {
    const decklist = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'crane-decklist.json'), 'utf8'));
    return buildDeck(decklist, indexFixtureCards([
        'crane-cards.json',
        'craneduel-cards.json',
        'craneduel-v03-extra-cards.json',
        'crane-baseline-extra-cards.json'
    ]));
}

// Crab Defense (EmeraldDB 3a8006b7) — holding-engine / defensive precon.
function loadCrabDeck() {
    return loadBySlug('crab', ['crab-cards.json']);
}

// Crab "Berserker Sacrifice" (EmeraldDB 59c4d29f) — Castle of the Forgotten
// military rush. Buys a wide board of cheap high-military bodies at zero fate,
// then converts the surplus bodies into skill and removal by sacrificing them
// (Silent Skirmisher, Stoic Gunso, Weight of Duty, Way of the Crab, Fulfill
// Your Duty). Iron Mine / Reprieve / Ceaseless Duty keep the sacrificed body
// on the table while the sacrifice effect still resolves.
function loadCrabSacrificeDeck() {
    return loadBySlug('crab-sacrifice', ['crab-sacrifice-cards.json']);
}

// Scorpion "Poison Mill" v0.6 (EmeraldDB 914dc4d4) — dishonor/mill deck.
function loadScorpionDeck() {
    return loadBySlug('scorpion', ['scorpion-cards.json']);
}

// Scorpion "Bid War" (EmeraldDB 2bf73f61) — Kyuden Bayushi honor-dial control.
// Wins by bidding into the low-honor band (<=6) where Shadow Stalker, Alibi
// Artist and the stronghold's ready bonus all turn on, then converting the dial
// gap into cards (Regal Bearing), removal (I Can Swim) and debuffs (Make an
// Opening). Duty is the safety net that lets it live down there.
function loadScorpionBidWarDeck() {
    return loadBySlug('scorpion-bidwar', ['scorpion-bidwar-cards.json']);
}

// Lion Duelist v0.3 (EmeraldDB 105158ff) — Kyuden Ikoma honor-switch Lion. Bids low
// to hold the honor lead that turns on Matsu Tsuko's free province break, Matsu
// Agetoki's conflict move, Matsu Mitsuko's move-in and Blade of 10,000 Battles,
// then converts every conflict win into cards and bowed enemies.
function loadLionDuelistDeck() {
    const decklist = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'lion-duelist-decklist.json'), 'utf8'));
    return buildDeck(decklist, indexFixtureCards(['lion-duelist-cards.json']));
}

// Lion Swarm v0.3 (EmeraldDB 27a913d1) — cheap-body province-trading rush.
function loadLionDeck() {
    return loadBySlug('lion', ['lion-cards.json']);
}

function loadPhoenixDeck() {
    return loadBySlug('phoenix', ['phoenix-cards.json']);
}

// Phoenix "Shugenja Spells" (EmeraldDB b260d778) — Kyuden Isawa spell
// recursion, ring manipulation, and Display of Power province trades.
function loadPhoenixShugenjaDeck() {
    return loadBySlug('phoenix-shugenja', ['phoenix-shugenja-cards.json']);
}

// Phoenix "Phoenix" (EmeraldDB 2c127136) — the Fushicho rebirth deck. Zero-fate
// bodies cycle through the dynasty discard and come back off Fushicho's
// leaves-play interrupt, Forebearer's Echoes and My Ancestor's Strength.
function loadPhoenixPhoenixDeck() {
    return loadBySlug('phoenix-phoenix', ['phoenix-phoenix-cards.json']);
}

function loadDragonDeck() {
    return loadBySlug('dragon', ['dragon-cards.json']);
}

// Dragon "Attachments" (EmeraldDB ce8df8ae) — Iron Mountain Castle tower
// deck with Crab splash.
function loadDragonAttachmentsDeck() {
    return loadBySlug('dragon-attachments', ['dragon-attachments-cards.json']);
}

// Crane "Courtier Honor" (EmeraldDB db118806) — Seven Fold Palace honor race.
// Wins at 25 honor rather than by conquest: it fields a wide board of cheap
// Courtiers, honors them (Way of the Crane, Court Games, A Perfect Cut, Tsuma),
// and converts each honored body into honor income (the stronghold's attacker
// reaction, Doji Hotaru, Honored Blade, Kakita Asami's political drain, Bonsai
// Garden on air conflicts, and Way of the Chrysanthemum off the honor dial).
function loadCraneHonorDeck() {
    const decklist = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'crane-honor-decklist.json'), 'utf8'));
    return buildDeck(decklist, indexFixtureCards(['crane-honor-cards.json']));
}

// Lion "Honor" v0.6 (EmeraldDB 3a5d87d2) — Kyuden Ikoma honor RACE. Unlike the Lion
// Duelist list (which treats the honor lead as a switch that turns other cards
// on), this deck plans to reach 25 honor outright: Seeker of Air over two air
// provinces, Before the Throne's 2-honor break, Kenson no Gakka honoring its own
// defenders, and a per-card faucet on almost every body (Ikoma Prodigy, Revered
// Ikoma, Ardent Omoidasu, Bushido Adherent, Hero of Three Trees, Chronicler of
// Conquests, Honored Blade) doubled by Way of the Chrysanthemum off a floor dial.
function loadLionHonorDeck() {
    const decklist = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'lion-honor-decklist.json'), 'utf8'));
    return buildDeck(decklist, indexFixtureCards(['lion-honor-cards.json']));
}

function loadCraneDuelDeck() {
    return loadBySlug('craneduel', ['craneduel-cards.json', 'craneduel-v03-extra-cards.json']);
}

module.exports = { buildDeck, loadCards, loadDecklist, loadUnicornDeck, loadUnicornRevealDeck, loadCraneDeck, loadCraneHonorDeck, loadCrabDeck, loadCrabSacrificeDeck, loadScorpionDeck, loadScorpionBidWarDeck, loadLionDeck, loadLionDuelistDeck, loadLionHonorDeck, loadPhoenixDeck, loadPhoenixShugenjaDeck, loadPhoenixPhoenixDeck, loadDragonDeck, loadDragonAttachmentsDeck, loadCraneDuelDeck, FIXTURES };
