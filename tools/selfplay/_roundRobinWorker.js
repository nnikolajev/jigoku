'use strict';

// Isolated job worker for botRoundRobin.js. Each invocation runs one chunk of
// one matchup and streams completed games as JSONL so parent can salvage work
// if a card interaction hangs or process runs out of memory.

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('./harness.js');
const { getDeckLoader } = require('./deckRegistry.js');

async function main() {
    const leftLabel = process.argv[2];
    const rightLabel = process.argv[3];
    const games = Number.parseInt(process.argv[4], 10);
    const botSeed = Number.parseInt(process.argv[5], 10);
    const startIndex = Number.parseInt(process.argv[6], 10) || 0;
    const drawBidPolicy = process.argv[7] === 'legacy' ? 'legacy' : 'adaptive';
    const omniscient = process.argv[8] === 'true';
    const engineVersion = process.argv[9] === 'v2' ? 'v2' : 'v1';
    const v2Mode = ['pass-through', 'shadow', 'enabled'].includes(process.argv[10]) ? process.argv[10] : 'enabled';
    const loadLeftDeck = getDeckLoader(leftLabel);
    const loadRightDeck = getDeckLoader(rightLabel);

    if(!loadLeftDeck || !loadRightDeck || !Number.isInteger(games) || games < 1 ||
        !isDeployableSeed(botSeed)) {
        process.stderr.write('usage: node _roundRobinWorker.js <leftDeck> <rightDeck> <games> <botSeed 1..3> <startIndex> [adaptive|legacy] [omniscient]\n');
        process.exit(2);
    }

    for(let offset = 0; offset < games; offset++) {
        const gameIndex = startIndex + offset;
        const leftFirst = gameIndex % 2 === 0;
        const names = leftFirst ? [leftLabel, rightLabel] : [rightLabel, leftLabel];
        const decks = leftFirst
            ? { deckA: loadLeftDeck(), deckB: loadRightDeck() }
            : { deckA: loadRightDeck(), deckB: loadLeftDeck() };
        const result = await runGame({
            names,
            seeds: [botSeed, botSeed],
            omniscient: [omniscient, omniscient],
            drawBidPolicies: [drawBidPolicy, drawBidPolicy],
            engineVersions: [engineVersion, engineVersion],
            v2Modes: [v2Mode, v2Mode],
            ...decks,
            trace: false
        });

        process.stdout.write(JSON.stringify({
            gameIndex,
            winner: result.winner || null,
            reason: result.winReason || result.stopReason || null
        }) + '\n');
    }
}

function isDeployableSeed(seed) {
    return Number.isInteger(seed) && seed >= 1 && seed <= 3;
}

if(require.main === module) {
    main().catch((error) => {
        process.stderr.write(String(error && error.stack || error) + '\n');
        process.exit(1);
    });
}

module.exports = { isDeployableSeed };
