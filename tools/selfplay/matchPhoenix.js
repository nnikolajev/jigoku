'use strict';

// Phoenix "For Honor and Glory" (glory deck) vs the Crane precon. Seats alternate
// to cancel first-player advantage. Usage:
//   node tools/selfplay/matchPhoenix.js [games] [phoenixSeed] [--trace]
// Seeds: 1 fate-aware (default), 2 old heuristic, 3 board-aware. Crane uses seed 1.

const { runGame } = require('./harness.js');
const { loadPhoenixDeck, loadCraneDeck } = require('./deckLoader.js');

async function main() {
    const games = parseInt(process.argv[2], 10) || 20;
    const parsedSeed = Number.parseInt(process.argv[3], 10);
    const phoenixSeed = Number.isInteger(parsedSeed) && parsedSeed >= 1 && parsedSeed <= 3 ? parsedSeed : 1;
    const trace = process.argv.includes('--trace');

    let phoenixWins = 0;
    let craneWins = 0;
    let other = 0;
    let roundsTotal = 0;
    const reasons = {};
    const traceHistogram = {};

    for(let i = 0; i < games; i++) {
        const phoenixFirst = i % 2 === 0;
        const names = phoenixFirst ? ['Phoenix', 'Crane'] : ['Crane', 'Phoenix'];
        const seeds = phoenixFirst ? [phoenixSeed, 1] : [1, phoenixSeed];
        const decks = phoenixFirst
            ? { deckA: loadPhoenixDeck(), deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: loadPhoenixDeck() };

        let controllers = null;
        const result = await runGame({
            names,
            seeds,
            ...decks,
            trace,
            onControllers: (list) => {
                controllers = list;
            }
        });

        roundsTotal += result.rounds;
        const key = `${result.winner || 'none'}:${result.winReason || 'none'}`;
        reasons[key] = (reasons[key] || 0) + 1;
        if(result.winner === 'Phoenix') {
            phoenixWins++;
        } else if(result.winner === 'Crane') {
            craneWins++;
        } else {
            other++;
        }

        if(trace && controllers) {
            const phoenixController = controllers[phoenixFirst ? 0 : 1];
            for(const entry of phoenixController.trace || []) {
                traceHistogram[entry.reason] = (traceHistogram[entry.reason] || 0) + 1;
                // Per-card counts for hand plays and triggered abilities, so
                // "does card X ever fire?" is answerable from the histogram.
                if(entry.result === 'success' && entry.target &&
                    ['play-conflict-card', 'trigger-hinted-ability', 'play-preconflict-attachment', 'use-board-ability'].includes(entry.reason)) {
                    const cardKey = `card: ${entry.target}`;
                    traceHistogram[cardKey] = (traceHistogram[cardKey] || 0) + 1;
                }
            }
        }
        process.stdout.write(`game ${i + 1}/${games}: winner=${result.winner} reason=${result.winReason} rounds=${result.rounds}\n`);
    }

    console.log(`\nPhoenix (seed ${phoenixSeed}) ${phoenixWins} - ${craneWins} Crane (other ${other}), avg rounds ${(roundsTotal / games).toFixed(1)}`);
    console.log('win reasons:', JSON.stringify(reasons, null, 1));
    if(trace) {
        const sorted = Object.entries(traceHistogram).sort((a, b) => b[1] - a[1]);
        console.log('phoenix decision reasons:');
        for(const [reason, count] of sorted) {
            console.log(`  ${count}\t${reason}`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
