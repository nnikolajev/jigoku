'use strict';

// Cache one EmeraldDB deck and the exact card records required by self-play.
// Usage:
//   node tools/selfplay/importEmeraldDeckFixture.js <deck-url-or-id> <fixture-slug> [display-name]

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');
const DECKLIST_API = 'https://www.emeralddb.org/api/decklists/';
const CARDS_API = 'https://www.emeralddb.org/api/cards';

function deckId(value) {
    const match = String(value || '').match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
    if(!match) {
        throw new Error(`Expected an EmeraldDB deck URL or UUID, got: ${value || '<empty>'}`);
    }
    return match[1];
}

async function json(url) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if(!response.ok) {
        throw new Error(`${response.status} ${response.statusText} fetching ${url}`);
    }
    return response.json();
}

async function main(argv = process.argv.slice(2)) {
    const [deckUrlOrId, slug, displayName] = argv;
    if(!deckUrlOrId || !/^[a-z0-9-]+$/.test(slug || '')) {
        throw new Error('Usage: importEmeraldDeckFixture <deck-url-or-id> <fixture-slug> [display-name]');
    }

    const id = deckId(deckUrlOrId);
    const [decklist, cards] = await Promise.all([
        json(`${DECKLIST_API}${id}`),
        json(CARDS_API)
    ]);
    if(displayName) {
        decklist.name = displayName;
    }

    const wanted = new Set(Object.keys(decklist.cards || {}));
    const selected = cards.filter((card) => wanted.has(card.id))
        .sort((left, right) => left.id.localeCompare(right.id));
    const found = new Set(selected.map((card) => card.id));
    const missing = [...wanted].filter((cardId) => !found.has(cardId));
    if(missing.length > 0) {
        throw new Error(`EmeraldDB returned no card data for: ${missing.join(', ')}`);
    }

    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(path.join(FIXTURES, `${slug}-decklist.json`), `${JSON.stringify(decklist, null, 2)}\n`);
    fs.writeFileSync(path.join(FIXTURES, `${slug}-cards.json`), `${JSON.stringify(selected, null, 2)}\n`);
    process.stdout.write(`Cached ${decklist.name}: ${selected.length} unique cards (${wanted.size} requested).\n`);
}

if(require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = { deckId, main };
