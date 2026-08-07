'use strict';

// Crab Berserker Sacrifice (Castle of the Forgotten rush) vs the Crane precon.
// Seats alternate to cancel first-player advantage. Usage:
//   node tools/selfplay/matchCrabSacrifice.js [games] [seed] [--trace]
// Seeds: 1 fate-aware (default), 2 old heuristic, 3 board-aware. Crane uses seed 1.
//
// This is a DIAGNOSTIC script, not a measurement. A single opponent on a single
// shuffle base cannot answer "is this deck good" — use
//   SUBJECT=CrabSacrifice node tools/selfplay/deckFieldWinRate.js
// for that, per `.claude/skills/roundrobin/SKILL.md`.

const { runGame } = require('./harness.js');
const { loadCrabSacrificeDeck, loadCraneDeck } = require('./deckLoader.js');

async function main() {
    const games = parseInt(process.argv[2], 10) || 20;
    const parsedSeed = Number.parseInt(process.argv[3], 10);
    const botSeed = Number.isInteger(parsedSeed) && parsedSeed >= 1 && parsedSeed <= 3 ? parsedSeed : 1;
    const trace = process.argv.includes('--trace');

    let botWins = 0;
    let craneWins = 0;
    let other = 0;
    let roundsTotal = 0;
    const reasons = {};
    const traceHistogram = {};

    for(let i = 0; i < games; i++) {
        const botFirst = i % 2 === 0;
        const names = botFirst ? ['CrabSacrifice', 'Crane'] : ['Crane', 'CrabSacrifice'];
        const seeds = botFirst ? [botSeed, 1] : [1, botSeed];
        const decks = botFirst
            ? { deckA: loadCrabSacrificeDeck(), deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: loadCrabSacrificeDeck() };

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
        if(result.winner === 'CrabSacrifice') {
            botWins++;
        } else if(result.winner === 'Crane') {
            craneWins++;
        } else {
            other++;
        }

        if(trace && controllers) {
            const botController = controllers[botFirst ? 0 : 1];
            for(const entry of botController.trace || []) {
                traceHistogram[entry.reason] = (traceHistogram[entry.reason] || 0) + 1;
                if(entry.result === 'success' && entry.target &&
                    ['play-conflict-card', 'trigger-hinted-ability', 'play-preconflict-attachment', 'use-board-ability'].includes(entry.reason)) {
                    const cardKey = `card: ${entry.target}`;
                    traceHistogram[cardKey] = (traceHistogram[cardKey] || 0) + 1;
                }
            }
        }
        process.stdout.write(`game ${i + 1}/${games}: winner=${result.winner} reason=${result.winReason} rounds=${result.rounds}\n`);
    }

    console.log(`\nCrabSacrifice (seed ${botSeed}) ${botWins} - ${craneWins} Crane (other ${other}), avg rounds ${(roundsTotal / games).toFixed(1)}`);
    console.log('win reasons:', JSON.stringify(reasons, null, 1));
    if(trace) {
        const sorted = Object.entries(traceHistogram).sort((a, b) => b[1] - a[1]);
        console.log('crab-sacrifice decision reasons:');
        for(const [reason, count] of sorted) {
            console.log(`  ${count}\t${reason}`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
