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
    // Per-DECK engine selection. Without this, `--engine-version v2` puts V2 on
    // both seats, so a deck's number moves for two reasons at once and cannot be
    // compared against an all-V1 stored baseline. Naming decks here pilots only
    // those with V2 and leaves the rest of the field on V1, which is the
    // condition the baselines in `baselines/v1/` were recorded under.
    const v2Decks = new Set(String(process.argv[11] || '').split(',').filter(Boolean));
    // The injected V2 profile travels by env var, not argv: it is JSON and
    // shell-quoting it through a spawn argument is a portability trap.
    let v2Profile;
    if(process.env.V2_PROFILE_JSON) {
        try {
            v2Profile = JSON.parse(process.env.V2_PROFILE_JSON);
        } catch(error) {
            process.stderr.write('bad V2_PROFILE_JSON: ' + error.message + '\n');
            process.exit(2);
        }
    }
    const engineFor = (label) => v2Decks.size > 0
        ? (v2Decks.has(label) ? 'v2' : 'v1')
        : engineVersion;
    // Say out loud what this job is actually running. A silently-ignored
    // override is the failure mode that has wasted the most time on this work:
    // a measurement that looks valid but tested the wrong configuration.
    if(v2Decks.size > 0 || v2Profile) {
        process.stderr.write(`[worker] v2Decks=${[...v2Decks].join(',') || '(none)'} ` +
            `v2Mode=${v2Mode} v2Profile=${v2Profile ? JSON.stringify(v2Profile) : '(none)'}\n`);
    }
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
        // Engines follow the SEAT, and seats alternate, so they are resolved
        // from the name in each seat rather than fixed per matchup.
        const engines = names.map(engineFor);
        const result = await runGame({
            names,
            seeds: [botSeed, botSeed],
            omniscient: [omniscient, omniscient],
            drawBidPolicies: [drawBidPolicy, drawBidPolicy],
            engineVersions: engines,
            v2Modes: engines.map((engine) => engine === 'v2' ? v2Mode : undefined),
            v2Profiles: engines.map((engine) => engine === 'v2' ? v2Profile : undefined),
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
