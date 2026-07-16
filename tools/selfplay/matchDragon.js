'use strict';

// Dragon "Monks In Da High House" (Togashi Mitsu card engine) vs the Crane precon. Seats alternate
// to cancel first-player advantage. Usage:
//   node tools/selfplay/matchDragon.js [games] [dragonSeed] [--trace]
// Seeds: 1 fate-aware (default), 2 old heuristic, 5 omniscient. Crane uses seed 1.

const { runGame } = require('./harness.js');
const { loadDragonDeck, loadCraneDeck } = require('./deckLoader.js');

async function main() {
    const games = parseInt(process.argv[2], 10) || 20;
    const parsedSeed = Number.parseInt(process.argv[3], 10);
    const dragonSeed = Number.isInteger(parsedSeed) && parsedSeed >= 1 && parsedSeed <= 5 ? parsedSeed : 1;
    const trace = process.argv.includes('--trace');

    let dragonWins = 0;
    let craneWins = 0;
    let other = 0;
    let roundsTotal = 0;
    const reasons = {};
    const traceHistogram = {};

    for(let i = 0; i < games; i++) {
        const dragonFirst = i % 2 === 0;
        const names = dragonFirst ? ['Dragon', 'Crane'] : ['Crane', 'Dragon'];
        const seeds = dragonFirst ? [dragonSeed, 1] : [1, dragonSeed];
        const decks = dragonFirst
            ? { deckA: loadDragonDeck(), deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: loadDragonDeck() };

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
        if(result.winner === 'Dragon') {
            dragonWins++;
        } else if(result.winner === 'Crane') {
            craneWins++;
        } else {
            other++;
        }

        if(trace && controllers) {
            const dragonController = controllers[dragonFirst ? 0 : 1];
            for(const entry of dragonController.trace || []) {
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

    console.log(`\nDragon (seed ${dragonSeed}) ${dragonWins} - ${craneWins} Crane (other ${other}), avg rounds ${(roundsTotal / games).toFixed(1)}`);
    console.log('win reasons:', JSON.stringify(reasons, null, 1));
    if(trace) {
        const sorted = Object.entries(traceHistogram).sort((a, b) => b[1] - a[1]);
        console.log('dragon decision reasons:');
        for(const [reason, count] of sorted) {
            console.log(`  ${count}\t${reason}`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
