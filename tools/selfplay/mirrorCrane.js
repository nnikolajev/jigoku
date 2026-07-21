'use strict';

// TRUE MIRROR: the Crane precon on BOTH seats, seed 3 vs seed 1 — isolates the seed effect from deck noise. Seats alternate
// to cancel first-player advantage. Usage:
//   node tools/selfplay/mirrorCrane.js [games] [seed] [--trace]

const { runGame } = require('./harness.js');
const { loadCraneDeck } = require('./deckLoader.js');

async function main() {
    const games = parseInt(process.argv[2], 10) || 20;
    const omniSeed = Math.min(3, Math.max(1, parseInt(process.argv[3], 10) || 1));
    const trace = process.argv.includes('--trace');

    let omniWins = 0;
    let craneWins = 0;
    let other = 0;
    let roundsTotal = 0;
    const reasons = {};
    const traceHistogram = {};

    for(let i = 0; i < games; i++) {
        const omniFirst = i % 2 === 0;
        const names = omniFirst ? ['Omni', 'Crane'] : ['Crane', 'Omni'];
        const seeds = [omniSeed, omniSeed];
        const omniscient = omniFirst ? [true, false] : [false, true];
        const decks = omniFirst
            ? { deckA: loadCraneDeck(), deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: loadCraneDeck() };

        let controllers = null;
        const result = await runGame({
            names,
            seeds,
            omniscient,
            ...decks,
            trace,
            onControllers: (list) => {
                controllers = list;
            }
        });

        roundsTotal += result.rounds;
        const key = `${result.winner || 'none'}:${result.winReason || 'none'}`;
        reasons[key] = (reasons[key] || 0) + 1;
        if(result.winner === 'Omni') {
            omniWins++;
        } else if(result.winner === 'Crane') {
            craneWins++;
        } else {
            other++;
        }

        if(trace && controllers) {
            const omniController = controllers[omniFirst ? 0 : 1];
            for(const entry of omniController.trace || []) {
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

    console.log(`\nOmni (seed ${omniSeed}) ${omniWins} - ${craneWins} Crane (other ${other}), avg rounds ${(roundsTotal / games).toFixed(1)}`);
    console.log('win reasons:', JSON.stringify(reasons, null, 1));
    if(trace) {
        const sorted = Object.entries(traceHistogram).sort((a, b) => b[1] - a[1]);
        console.log('omni decision reasons:');
        for(const [reason, count] of sorted) {
            console.log(`  ${count}\t${reason}`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
