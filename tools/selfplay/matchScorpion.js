'use strict';

// Scorpion "Poison Mill" (dishonor deck) vs the Crane precon. Seats alternate
// to cancel first-player advantage. Usage:
//   node tools/selfplay/matchScorpion.js [games] [scorpionSeed] [--trace]
// Seeds: 1 fate-aware (default), 2 old heuristic, 3 omniscient. Crane uses seed 1.

const { runGame } = require('./harness.js');
const { loadScorpionDeck, loadCraneDeck } = require('./deckLoader.js');

async function main() {
    const games = parseInt(process.argv[2], 10) || 20;
    const parsedSeed = Number.parseInt(process.argv[3], 10);
    const scorpionSeed = Number.isInteger(parsedSeed) && parsedSeed >= 1 && parsedSeed <= 3 ? parsedSeed : 1;
    const trace = process.argv.includes('--trace');

    let scorpionWins = 0;
    let craneWins = 0;
    let other = 0;
    let roundsTotal = 0;
    const reasons = {};
    const traceHistogram = {};

    for(let i = 0; i < games; i++) {
        const scorpionFirst = i % 2 === 0;
        const names = scorpionFirst ? ['Scorpion', 'Crane'] : ['Crane', 'Scorpion'];
        const seeds = scorpionFirst ? [scorpionSeed, 1] : [1, scorpionSeed];
        const decks = scorpionFirst
            ? { deckA: loadScorpionDeck(), deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: loadScorpionDeck() };

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
        if(result.winner === 'Scorpion') {
            scorpionWins++;
        } else if(result.winner === 'Crane') {
            craneWins++;
        } else {
            other++;
        }

        if(trace && controllers) {
            const scorpionController = controllers[scorpionFirst ? 0 : 1];
            for(const entry of scorpionController.trace || []) {
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

    console.log(`\nScorpion (seed ${scorpionSeed}) ${scorpionWins} - ${craneWins} Crane (other ${other}), avg rounds ${(roundsTotal / games).toFixed(1)}`);
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
