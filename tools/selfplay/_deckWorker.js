'use strict';

// Child-process worker for winRates.js: plays one deck's games vs Crane and
// streams ONE JSON line per completed game to stdout. Run in its own process so
// a game that hangs in a synchronous engine loop (a rare card interaction) or
// runs the heap out of memory kills only this child — the parent keeps the
// games that already streamed and moves on. Usage:
//   node _deckWorker.js <deckLabel> <games> <botSeed>

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('./harness.js');
const { getDeckLoader } = require('./deckRegistry.js');

const BASELINE_DECK = 'Crane';
const loadCraneDeck = getDeckLoader(BASELINE_DECK);

async function main() {
    const label = process.argv[2];
    const games = parseInt(process.argv[3], 10) || 30;
    const botSeed = process.argv[4] === '4' ? 4 : 1;
    const loadDeck = getDeckLoader(label);
    if(!loadDeck || label === BASELINE_DECK) {
        process.stderr.write(`unknown deck ${label}\n`);
        process.exit(2);
    }

    for(let i = 0; i < games; i++) {
        const botFirst = i % 2 === 0;
        const names = botFirst ? [label, BASELINE_DECK] : [BASELINE_DECK, label];
        const seeds = botFirst ? [botSeed, 1] : [1, botSeed];
        const decks = botFirst
            ? { deckA: loadDeck(), deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: loadDeck() };

        const result = await runGame({ names, seeds, ...decks, trace: false });
        // One line per game so the parent salvages partial results on a hang.
        process.stdout.write(JSON.stringify({ winner: result.winner || null, reason: result.winReason || null }) + '\n');
    }
}

main().catch((err) => {
    process.stderr.write(String(err && err.stack || err) + '\n');
    process.exit(1);
});
