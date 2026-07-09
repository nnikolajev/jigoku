'use strict';

// Iterative self-play RL: turn the (weak) one-shot evaluator into a bot that
// beats the heuristic, by policy iteration over generations.
//
// Each generation:
//   1. Play games with the CURRENT model, recording every decision:
//        - model vs model with exploration (epsilon) -> on-policy coverage,
//          the model sees the outcome of moves it would not greedily pick;
//        - model vs heuristic (both seats recorded) -> keeps competent,
//          province-breaking trajectories in the data so the model learns that
//          committing/attacking (not stalling) wins.
//   2. Append to a replay buffer (capped, sliding window).
//   3. Retrain the model on the buffer (python train.py).
//   4. Evaluate the greedy model vs the heuristic (no exploration).
//   5. Decay epsilon. Keep the best-winrate weights.
//
// The buffer is seeded from the heuristic trajectories so generation 1 already
// contains good play to imitate while it starts correcting its own mistakes.
//
//   node tools/selfplay/generations.js --gens 6 --games 80 --eval 30 \
//       --buffer tools/selfplay/out/buffer.jsonl --seed-data tools/selfplay/out/trajectories.jsonl

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runGame, loadEvaluator } = require('./harness.js');

function parseArgs(argv) {
    const a = {
        gens: 6, games: 80, evalGames: 30, rounds: 25,
        epsilon: 0.4, epsilonDecay: 0.75, epsilonMin: 0.08,
        bufferCap: 400000,
        buffer: 'tools/selfplay/out/buffer.jsonl',
        seedData: 'tools/selfplay/out/trajectories.jsonl',
        outDir: 'tools/selfplay/out',
        weights: 'tools/selfplay/out/weights.json'
    };
    for(let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if(k === '--gens') a.gens = Number(argv[++i]);
        else if(k === '--games') a.games = Number(argv[++i]);
        else if(k === '--eval') a.evalGames = Number(argv[++i]);
        else if(k === '--epsilon') a.epsilon = Number(argv[++i]);
        else if(k === '--buffer') a.buffer = argv[++i];
        else if(k === '--seed-data') a.seedData = argv[++i];
        else if(k === '--weights') a.weights = argv[++i];
        else if(k === '--rounds') a.rounds = Number(argv[++i]);
    }
    return a;
}

const NAMES = ['BotA', 'BotB'];

// Append a game's decision records (schema stripped) to the buffer stream.
function recordSink(stream) {
    return (record) => {
        const { stateSchema, optionSchema, ...slim } = record;
        stream.write(JSON.stringify(slim) + '\n');
    };
}

// Trim the buffer to the last `cap` lines (sliding replay window).
function trimBuffer(file, cap) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if(lines.length > cap) {
        fs.writeFileSync(file, lines.slice(lines.length - cap).join('\n') + '\n');
    }
    return Math.min(lines.length, cap);
}

async function playDataGames(count, evaluator, epsilon, sink) {
    let decided = 0;
    for(let i = 0; i < count; i++) {
        // Model vs heuristic, both seats recorded, alternating sides. The
        // heuristic opponent keeps games short and sensible (model-vs-model
        // with a weak/exploring model produces degenerate, memory-heavy games);
        // the model seat still explores (epsilon) so its own move consequences
        // enter the data on-policy, while the heuristic seat contributes
        // competent, province-breaking trajectories to learn from.
        const modelFirst = i % 2 === 0;
        const seeds = modelFirst ? [3, 1] : [1, 3];
        const evals = modelFirst ? [evaluator, undefined] : [undefined, evaluator];
        const explore = modelFirst ? [epsilon, 0] : [0, epsilon];
        const r = await runGame({
            names: NAMES, seeds: seeds, evaluators: evals, explore: explore,
            maxRounds: 25, recordTrajectories: true, onRecord: sink
        });
        if(r.winner) decided++;
    }
    return { decided };
}

async function evalVsHeuristic(count, evaluator, rounds) {
    let evalWins = 0, decided = 0;
    for(let i = 0; i < count; i++) {
        const evalSeat = i % 2;
        const seeds = evalSeat === 0 ? [3, 1] : [1, 3];
        const evals = evalSeat === 0 ? [evaluator, undefined] : [undefined, evaluator];
        const r = await runGame({ names: NAMES, seeds: seeds, evaluators: evals, maxRounds: rounds });
        if(!r.winner) continue;
        decided++;
        if(r.winner === NAMES[evalSeat]) evalWins++;
    }
    return { evalWins, decided, winrate: decided ? evalWins / decided : 0 };
}

function train(bufferFile, outFile) {
    // Reuse the seed-data schema (features are fixed); point train.py at it.
    const schema = bufferFile.replace(/\.jsonl$/, '') + '.schema.json';
    execFileSync('python', ['tools/selfplay/train.py', '--data', bufferFile,
        '--schema', schema, '--out', outFile], { stdio: 'inherit' });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    fs.mkdirSync(path.resolve(args.outDir), { recursive: true });

    // Seed the buffer from the heuristic trajectories (good play to imitate) and
    // copy its schema next to the buffer for train.py.
    fs.copyFileSync(path.resolve(args.seedData), path.resolve(args.buffer));
    const seedSchema = args.seedData.replace(/\.jsonl$/, '') + '.schema.json';
    fs.copyFileSync(path.resolve(seedSchema), args.buffer.replace(/\.jsonl$/, '') + '.schema.json');
    console.log(`buffer seeded from ${args.seedData}`);

    // Generation 0 model = current weights (trained on heuristic data).
    let epsilon = args.epsilon;
    let best = { gen: -1, winrate: -1, file: null };
    const history = [];

    for(let gen = 1; gen <= args.gens; gen++) {
        const t0 = Date.now();
        const evaluator = loadEvaluator(path.resolve(args.weights));

        // 1. Play + record into the buffer (append).
        const stream = fs.createWriteStream(path.resolve(args.buffer), { flags: 'a' });
        const sink = recordSink(stream);
        const play = await playDataGames(args.games, evaluator, epsilon, sink);
        await new Promise((res) => stream.end(res));
        const bufRows = trimBuffer(path.resolve(args.buffer), args.bufferCap);

        // 2. Retrain on the buffer.
        const genWeights = path.resolve(args.outDir, `weights_gen${gen}.json`);
        train(path.resolve(args.buffer), genWeights);

        // 3. Evaluate the greedy new model vs the heuristic.
        const newEval = loadEvaluator(genWeights);
        const ev = await evalVsHeuristic(args.evalGames, newEval, args.rounds);

        // Adopt the new weights as current for the next generation.
        fs.copyFileSync(genWeights, path.resolve(args.weights));
        if(ev.winrate > best.winrate) {
            best = { gen: gen, winrate: ev.winrate, file: genWeights };
        }
        history.push({ gen, epsilon: Number(epsilon.toFixed(3)), bufRows, winrate: Number((100 * ev.winrate).toFixed(1)) });
        console.log(`\n=== gen ${gen}: eps=${epsilon.toFixed(3)} buffer=${bufRows} rows | ` +
            `data ${play.decided}/${args.games} decided | eval ${ev.evalWins}/${ev.decided} = ` +
            `${(100 * ev.winrate).toFixed(1)}% vs heuristic | ${((Date.now() - t0) / 1000).toFixed(0)}s ===\n`);

        epsilon = Math.max(args.epsilonMin, epsilon * args.epsilonDecay);
    }

    // Restore the best weights as the deployed model.
    if(best.file) {
        fs.copyFileSync(best.file, path.resolve(args.weights));
    }
    console.log('===== generations summary =====');
    for(const h of history) {
        console.log(`gen ${h.gen}: eps=${h.epsilon} buffer=${h.bufRows} winrate=${h.winrate}%`);
    }
    console.log(`best: gen ${best.gen} @ ${(100 * best.winrate).toFixed(1)}% -> ${args.weights}`);
}

main().catch((err) => {
    console.error('generations failed:', err);
    process.exit(1);
});
