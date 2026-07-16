'use strict';

// Generate per-decision training data for the seed-4 learned evaluator.
// Runs N self-play games and streams one JSONL line per real (>=2-option)
// decision, each carrying the position features, every legal option's
// features, the chosen option index, and the game's terminal return for that
// player. Also writes a sibling <out>.schema.json describing the feature order.
//
//   node tools/selfplay/runTrajectories.js [count] [--out file.jsonl] [--rounds 25]

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');

function parseArgs(argv) {
    const args = { count: 50, out: 'tools/selfplay/out/trajectories.jsonl', rounds: 25 };
    for(let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if(a === '--out') {
            args.out = argv[++i];
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
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const out = fs.createWriteStream(outPath);

    let decisions = 0, games = 0, decided = 0, schemaWritten = false;
    const started = Date.now();

    const onRecord = (record) => {
        if(!schemaWritten) {
            fs.writeFileSync(
                outPath.replace(/\.jsonl$/, '') + '.schema.json',
                JSON.stringify({ stateSchema: record.stateSchema, optionSchema: record.optionSchema }, null, 2)
            );
            schemaWritten = true;
        }
        // Drop the repeated schema arrays from each line to keep the file small;
        // the sibling .schema.json carries them once.
        const { stateSchema, optionSchema, ...slim } = record;
        out.write(JSON.stringify(slim) + '\n');
        decisions++;
    };

    for(let i = 0; i < args.count; i++) {
        const r = await runGame({ maxRounds: args.rounds, recordTrajectories: true, onRecord: onRecord });
        games++;
        if(r.winner) {
            decided++;
        }
        if((i + 1) % 10 === 0 || i + 1 === args.count) {
            process.stdout.write(`games ${i + 1}/${args.count} decisions=${decisions} decided=${decided}\n`);
        }
    }
    out.end();

    console.log('\n===== trajectory generation =====');
    console.log(`games=${games} decided=${decided} decisions=${decisions} wallclock=${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`avg decisions/game=${(decisions / games).toFixed(1)}`);
    console.log(`data  -> ${outPath}`);
    console.log(`schema-> ${outPath.replace(/\.jsonl$/, '')}.schema.json`);
}

main().catch((err) => {
    console.error('runTrajectories failed:', err);
    process.exit(1);
});
