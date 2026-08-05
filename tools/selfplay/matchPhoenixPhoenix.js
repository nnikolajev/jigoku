'use strict';

// Phoenix "Phoenix" (Fushicho rotation) against a chosen opponent deck. Seats
// alternate to cancel first-player advantage. This is a DIAGNOSTIC runner —
// use it to read decision histograms and card utilisation, never as evidence
// that a change is good. For that, follow `.claude/skills/roundrobin/SKILL.md`.
//
//   node tools/selfplay/matchPhoenixPhoenix.js [games] [seed] [--trace] [--vs=Crane]

const { runGame } = require('./harness.js');
const { loadPhoenixPhoenixDeck } = require('./deckLoader.js');
const { getDeckLoader } = require('./deckRegistry.js');

async function main() {
    const games = parseInt(process.argv[2], 10) || 20;
    const parsedSeed = Number.parseInt(process.argv[3], 10);
    const seed = Number.isInteger(parsedSeed) && parsedSeed >= 1 && parsedSeed <= 4 ? parsedSeed : 1;
    const trace = process.argv.includes('--trace');
    const vsArg = process.argv.find((arg) => arg.startsWith('--vs='));
    const opponentLabel = vsArg ? vsArg.slice('--vs='.length) : 'Crane';
    const loadOpponent = getDeckLoader(opponentLabel);
    if(!loadOpponent) {
        throw new Error(`Unknown opponent deck: ${opponentLabel}`);
    }
    const label = 'PhoenixPhoenix';

    let wins = 0;
    let losses = 0;
    let other = 0;
    let roundsTotal = 0;
    const reasons = {};
    const traceHistogram = {};

    for(let i = 0; i < games; i++) {
        const phoenixFirst = i % 2 === 0;
        const names = phoenixFirst ? [label, opponentLabel] : [opponentLabel, label];
        const seeds = phoenixFirst ? [seed, 1] : [1, seed];
        const decks = phoenixFirst
            ? { deckA: loadPhoenixPhoenixDeck(), deckB: loadOpponent() }
            : { deckA: loadOpponent(), deckB: loadPhoenixPhoenixDeck() };

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
        if(result.winner === label) {
            wins++;
        } else if(result.winner === opponentLabel) {
            losses++;
        } else {
            other++;
        }

        if(trace && controllers) {
            const controller = controllers[phoenixFirst ? 0 : 1];
            for(const entry of controller.trace || []) {
                traceHistogram[entry.reason] = (traceHistogram[entry.reason] || 0) + 1;
                if(entry.result === 'success' && entry.target &&
                    ['play-conflict-card', 'trigger-hinted-ability', 'play-preconflict-attachment',
                        'use-board-ability', 'use-conflict-phase-ability'].includes(entry.reason)) {
                    const cardKey = `card: ${entry.target}`;
                    traceHistogram[cardKey] = (traceHistogram[cardKey] || 0) + 1;
                }
            }
        }
        const unfinished = result.winner ? '' : ` stop=${result.stopReason}${result.error ? ` error=${String(result.error).split('\n')[0]}` : ''}`;
        process.stdout.write(`game ${i + 1}/${games}: winner=${result.winner} reason=${result.winReason} rounds=${result.rounds} steps=${result.steps}${unfinished}\n`);
    }

    console.log(`\n${label} (seed ${seed}) ${wins} - ${losses} ${opponentLabel} (other ${other}), avg rounds ${(roundsTotal / games).toFixed(1)}`);
    console.log('win reasons:', JSON.stringify(reasons, null, 1));
    if(trace) {
        const sorted = Object.entries(traceHistogram).sort((a, b) => b[1] - a[1]);
        console.log('phoenix phoenix decision reasons:');
        for(const [reason, count] of sorted) {
            console.log(`  ${count}\t${reason}`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
