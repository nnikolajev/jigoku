'use strict';

// Measure the trained evaluator (seed 4) against fate-aware seed 1: the
// real test of whether learning improved play. Plays N games, alternating which
// seat is the evaluator so first-player advantage cancels, and reports the
// evaluator's win rate. >50% means the learned bot beats the heuristic.
//
//   node tools/selfplay/evalMatch.js [count] [--weights file.json] [--rounds 25]

const { runGame, loadEvaluator } = require('./harness.js');

function parseArgs(argv) {
    const args = { count: 40, weights: 'tools/selfplay/out/weights.json', rounds: 25 };
    for(let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if(a === '--weights') {
            args.weights = argv[++i];
        } else if(a === '--rounds') {
            args.rounds = Number(argv[++i]);
        } else if(/^\d+$/.test(a)) {
            args.count = Number(a);
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const evaluator = loadEvaluator(args.weights);
    const names = ['BotA', 'BotB'];

    let evalWins = 0, heurWins = 0, undecided = 0, evalAsFirst = 0, evalFirstWins = 0;
    const started = Date.now();

    for(let i = 0; i < args.count; i++) {
        // Alternate the evaluator seat each game.
        const evalSeat = i % 2; // 0 => BotA is eval, 1 => BotB is eval
        const seeds = evalSeat === 0 ? [4, 1] : [1, 4];
        const evaluators = evalSeat === 0 ? [evaluator, undefined] : [undefined, evaluator];
        const evalName = names[evalSeat];

        const r = await runGame({ names: names, seeds: seeds, evaluators: evaluators, maxRounds: args.rounds });
        if(!r.winner) {
            undecided++;
            continue;
        }
        const evalWon = r.winner === evalName;
        if(evalWon) {
            evalWins++;
        } else {
            heurWins++;
        }
        // First player each game is BotA (selectFirstPlayer picks player1 path
        // in setup via the bot's own choice, but track eval-as-first for a
        // rough control).
        if(evalSeat === 0) {
            evalAsFirst++;
            if(evalWon) {
                evalFirstWins++;
            }
        }
        if((i + 1) % 10 === 0 || i + 1 === args.count) {
            const decided = evalWins + heurWins;
            process.stdout.write(`game ${i + 1}/${args.count}: eval ${evalWins}-${heurWins} heuristic (${decided ? (100 * evalWins / decided).toFixed(0) : 0}% eval)\n`);
        }
    }

    const decided = evalWins + heurWins;
    console.log('\n===== eval match: seed 4 (learned) vs seed 1 (fate-aware) =====');
    console.log(`games=${args.count} decided=${decided} undecided=${undecided} wallclock=${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`evaluator wins: ${evalWins}/${decided} = ${decided ? (100 * evalWins / decided).toFixed(1) : 0}%`);
    console.log(`  (as first seat: ${evalFirstWins}/${evalAsFirst}; as second seat: ${evalWins - evalFirstWins}/${decided - evalAsFirst})`);
    console.log(decided && evalWins / decided > 0.5 ? 'LEARNED BOT WINS THE MATCHUP' : 'heuristic still ahead — more data / features / model needed');
}

main().catch((err) => {
    console.error('evalMatch failed:', err);
    process.exit(1);
});
