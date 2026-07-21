'use strict';

// Child-process worker for winRates.js: plays one deck's games vs Crane and
// streams ONE JSON line per completed game to stdout. Run in its own process so
// a game that hangs in a synchronous engine loop (a rare card interaction) or
// runs the heap out of memory kills only this child — the parent keeps the
// games that already streamed and moves on. Usage:
//   node _deckWorker.js <deckLabel> <games> <botSeed> <craneSeed>
//     <challengerPolicy> <challengerDrawBidPolicy> <craneDrawBidPolicy>
//     <challengerOmniscient> <craneOmniscient>

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('./harness.js');
const { getDeckLoader } = require('./deckRegistry.js');
const { parseBotSeed, seatSeeds } = require('./winRates.js');

const BASELINE_DECK = 'Crane';
const loadCraneDeck = getDeckLoader(BASELINE_DECK);

async function main() {
    const label = process.argv[2];
    const games = parseInt(process.argv[3], 10) || 30;
    const botSeed = parseBotSeed(process.argv[4]);
    const craneSeed = parseBotSeed(process.argv[5]);
    const challengerPolicy = ['generic', 'fate-aware', 'board-aware'].includes(process.argv[6])
        ? process.argv[6]
        : undefined;
    const challengerDrawBidPolicy = process.argv[7] === 'legacy' ? 'legacy' : 'adaptive';
    const craneDrawBidPolicy = process.argv[8] === 'legacy' ? 'legacy' : 'adaptive';
    const challengerOmniscient = process.argv[9] === 'true';
    const craneOmniscient = process.argv[10] === 'true';
    const loadDeck = getDeckLoader(label);
    if(!loadDeck || label === BASELINE_DECK) {
        process.stderr.write(`unknown deck ${label}\n`);
        process.exit(2);
    }

    for(let i = 0; i < games; i++) {
        const botFirst = i % 2 === 0;
        const names = botFirst ? [label, BASELINE_DECK] : [BASELINE_DECK, label];
        const seeds = seatSeeds(botFirst, botSeed, craneSeed);
        // Explicit analysis override applies only to challenger, independent
        // of seat order.
        const policies = botFirst
            ? [challengerPolicy, undefined]
            : [undefined, challengerPolicy];
        const drawBidPolicies = botFirst
            ? [challengerDrawBidPolicy, craneDrawBidPolicy]
            : [craneDrawBidPolicy, challengerDrawBidPolicy];
        const omniscient = botFirst
            ? [challengerOmniscient, craneOmniscient]
            : [craneOmniscient, challengerOmniscient];
        const decks = botFirst
            ? { deckA: loadDeck(), deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: loadDeck() };

        const result = await runGame({ names, seeds, policies, drawBidPolicies, omniscient, ...decks, trace: false });
        // One line per game so the parent salvages partial results on a hang.
        process.stdout.write(JSON.stringify({ winner: result.winner || null, reason: result.winReason || null }) + '\n');
    }
}

main().catch((err) => {
    process.stderr.write(String(err && err.stack || err) + '\n');
    process.exit(1);
});
