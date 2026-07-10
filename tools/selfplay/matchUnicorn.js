'use strict';

// Unicorn "Poison Mill" (dishonor deck) vs the Crane precon. Seats alternate
// to cancel first-player advantage. Usage:
//   node tools/selfplay/matchUnicorn.js [games] [unicornSeed] [--trace]
// unicornSeed 1 = heuristic, 4 = omniscient. Crane always plays seed 1.

const { runGame } = require('./harness.js');
const { loadUnicornDeck, loadCraneDeck } = require('./deckLoader.js');

async function main() {
    const games = parseInt(process.argv[2], 10) || 20;
    const unicornSeed = process.argv[3] === '4' ? 4 : 1;
    const trace = process.argv.includes('--trace');

    let unicornWins = 0;
    let craneWins = 0;
    let other = 0;
    let roundsTotal = 0;
    const reasons = {};
    const traceHistogram = {};

    for(let i = 0; i < games; i++) {
        const unicornFirst = i % 2 === 0;
        const names = unicornFirst ? ['Unicorn', 'Crane'] : ['Crane', 'Unicorn'];
        const seeds = unicornFirst ? [unicornSeed, 1] : [1, unicornSeed];
        const decks = unicornFirst
            ? { deckA: loadUnicornDeck(), deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: loadUnicornDeck() };

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
        if(result.winner === 'Unicorn') {
            unicornWins++;
        } else if(result.winner === 'Crane') {
            craneWins++;
        } else {
            other++;
        }

        if(trace && controllers) {
            const unicornController = controllers[unicornFirst ? 0 : 1];
            for(const entry of unicornController.trace || []) {
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

    console.log(`\nUnicorn (seed ${unicornSeed}) ${unicornWins} - ${craneWins} Crane (other ${other}), avg rounds ${(roundsTotal / games).toFixed(1)}`);
    console.log('win reasons:', JSON.stringify(reasons, null, 1));
    if(trace) {
        const sorted = Object.entries(traceHistogram).sort((a, b) => b[1] - a[1]);
        console.log('scorpion decision reasons:');
        for(const [reason, count] of sorted) {
            console.log(`  ${count}\t${reason}`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
