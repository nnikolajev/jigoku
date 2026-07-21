'use strict';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('./harness.js');
const { getDeckLoader } = require('./deckRegistry.js');
const { seededRandom } = require('./compareMulliganPolicies.js');

async function main() {
    const omniscientDeck = process.argv[2];
    const defaultDeck = process.argv[3];
    const games = Number.parseInt(process.argv[4], 10);
    const seed = Number.parseInt(process.argv[5], 10);
    const startIndex = Number.parseInt(process.argv[6], 10) || 0;
    const rngSeed = Number.parseInt(process.argv[7], 10);
    const trace = process.argv[8] === 'trace';
    const loadOmniscientDeck = getDeckLoader(omniscientDeck);
    const loadDefaultDeck = getDeckLoader(defaultDeck);
    if(!loadOmniscientDeck || !loadDefaultDeck || !Number.isInteger(games) || games < 1 ||
        !Number.isInteger(seed) || seed < 1 || seed > 3 || !Number.isInteger(rngSeed)) {
        process.stderr.write('usage: node _omniscientRoundRobinWorker.js <omniscientDeck> <defaultDeck> <games> <seed 1..3> <startIndex> <rngSeed>\n');
        process.exit(2);
    }

    const originalRandom = Math.random;
    try {
        for(let offset = 0; offset < games; offset++) {
            const gameIndex = startIndex + offset;
            Math.random = seededRandom(rngSeed + Math.floor(gameIndex / 2));
            const omniscientFirst = gameIndex % 2 === 0;
            const omniName = `Omniscient ${omniscientDeck}`;
            const defaultName = `Default ${defaultDeck}`;
            const names = omniscientFirst ? [omniName, defaultName] : [defaultName, omniName];
            const decks = omniscientFirst
                ? { deckA: loadOmniscientDeck(), deckB: loadDefaultDeck() }
                : { deckA: loadDefaultDeck(), deckB: loadOmniscientDeck() };
            let controllers = null;
            const result = await runGame({
                names,
                seeds: [seed, seed],
                omniscient: omniscientFirst ? [true, false] : [false, true],
                ...decks,
                trace,
                onControllers: (value) => { controllers = value; }
            });
            const histogram = (controller) => {
                const counts = {};
                for(const entry of controller?.trace || []) {
                    if(entry.result === 'success') {
                        counts[entry.reason] = (counts[entry.reason] || 0) + 1;
                    }
                }
                return counts;
            };
            const omniIndex = omniscientFirst ? 0 : 1;
            process.stdout.write(JSON.stringify({
                gameIndex,
                winner: result.winner === omniName
                    ? 'omniscient'
                    : result.winner === defaultName ? 'default' : null,
                reason: result.winReason || result.stopReason || null,
                omniscientTrace: trace ? histogram(controllers?.[omniIndex]) : undefined,
                defaultTrace: trace ? histogram(controllers?.[1 - omniIndex]) : undefined
            }) + '\n');
        }
    } finally {
        Math.random = originalRandom;
    }
}

main().catch((error) => {
    process.stderr.write(String(error && error.stack || error) + '\n');
    process.exit(1);
});
