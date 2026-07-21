'use strict';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('./harness.js');
const { getDeckLoader } = require('./deckRegistry.js');
const { seededRandom } = require('./compareMulliganPolicies.js');

function isDeployableSeed(seed) {
    return Number.isInteger(seed) && seed >= 1 && seed <= 3;
}

function histogram(controller) {
    const counts = {};
    for(const entry of controller?.trace || []) {
        if(entry.result === 'success') {
            counts[entry.reason] = (counts[entry.reason] || 0) + 1;
        }
    }
    return counts;
}

async function main() {
    const subjectDeck = process.argv[2];
    const opponentDeck = process.argv[3];
    const games = Number.parseInt(process.argv[4], 10);
    const subjectSeed = Number.parseInt(process.argv[5], 10);
    const opponentSeed = Number.parseInt(process.argv[6], 10);
    const startIndex = Number.parseInt(process.argv[7], 10) || 0;
    const rngSeed = Number.parseInt(process.argv[8], 10);
    const trace = process.argv[9] === 'trace';
    const loadSubjectDeck = getDeckLoader(subjectDeck);
    const loadOpponentDeck = getDeckLoader(opponentDeck);
    if(!loadSubjectDeck || !loadOpponentDeck || !Number.isInteger(games) || games < 1 ||
        !isDeployableSeed(subjectSeed) || !isDeployableSeed(opponentSeed) || !Number.isInteger(rngSeed)) {
        process.stderr.write('usage: node _seedRoundRobinWorker.js <subjectDeck> <opponentDeck> <games> <subjectSeed> <opponentSeed> <startIndex> <rngSeed> [trace]\n');
        process.exit(2);
    }

    const originalRandom = Math.random;
    try {
        for(let offset = 0; offset < games; offset++) {
            const gameIndex = startIndex + offset;
            Math.random = seededRandom(rngSeed + Math.floor(gameIndex / 2));
            const subjectFirst = gameIndex % 2 === 0;
            const subjectName = `Subject seed ${subjectSeed} ${subjectDeck}`;
            const opponentName = `Opponent seed ${opponentSeed} ${opponentDeck}`;
            const names = subjectFirst ? [subjectName, opponentName] : [opponentName, subjectName];
            const seeds = subjectFirst ? [subjectSeed, opponentSeed] : [opponentSeed, subjectSeed];
            const decks = subjectFirst
                ? { deckA: loadSubjectDeck(), deckB: loadOpponentDeck() }
                : { deckA: loadOpponentDeck(), deckB: loadSubjectDeck() };
            let controllers = null;
            const result = await runGame({
                names,
                seeds,
                ...decks,
                trace,
                onControllers: (value) => { controllers = value; }
            });
            const subjectIndex = subjectFirst ? 0 : 1;
            process.stdout.write(JSON.stringify({
                gameIndex,
                winner: result.winner === subjectName
                    ? 'subject'
                    : result.winner === opponentName ? 'opponent' : null,
                reason: result.winReason || result.stopReason || null,
                subjectTrace: trace ? histogram(controllers?.[subjectIndex]) : undefined,
                opponentTrace: trace ? histogram(controllers?.[1 - subjectIndex]) : undefined
            }) + '\n');
        }
    } finally {
        Math.random = originalRandom;
    }
}

if(require.main === module) {
    main().catch((error) => {
        process.stderr.write(String(error && error.stack || error) + '\n');
        process.exit(1);
    });
}

module.exports = { isDeployableSeed };
