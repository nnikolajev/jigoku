'use strict';

// CLI: run N self-play games, aggregate outcomes, optionally write per-game
// results as JSONL (one game per line) for later analysis / ML.
//
//   node tools/selfplay/runGames.js [count] [--out file.jsonl] [--rounds 25] [--quiet]

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');

function parseArgs(argv) {
    const args = { count: 10, out: null, rounds: 25, quiet: false };
    for(let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if(a === '--out') {
            args.out = argv[++i];
        } else if(a === '--rounds') {
            args.rounds = Number(argv[++i]);
        } else if(a === '--quiet') {
            args.quiet = true;
        } else if(/^\d+$/.test(a)) {
            args.count = Number(a);
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const names = ['BotA', 'BotB'];
    const agg = {
        games: 0, errors: 0, decided: 0,
        winReasons: {}, stopReasons: {},
        winsByName: { BotA: 0, BotB: 0 },
        firstPlayerWins: 0,
        sumRounds: 0, sumSteps: 0, sumMs: 0,
        sumStronghold: 0, sumProvinces: 0, sumConflicts: 0
    };
    const out = args.out ? fs.createWriteStream(path.resolve(args.out)) : null;
    const started = Date.now();

    for(let i = 0; i < args.count; i++) {
        const r = await runGame({ names: names, maxRounds: args.rounds });
        agg.games++;
        agg.sumRounds += r.rounds;
        agg.sumSteps += r.steps;
        agg.sumMs += r.elapsedMs;
        agg.stopReasons[r.stopReason] = (agg.stopReasons[r.stopReason] || 0) + 1;
        if(r.error) {
            agg.errors++;
        }
        if(r.winner) {
            agg.decided++;
            agg.winsByName[r.winner] = (agg.winsByName[r.winner] || 0) + 1;
            agg.winReasons[r.winReason] = (agg.winReasons[r.winReason] || 0) + 1;
        }
        // Sum event counts across both seats (deck-level rates, not per-winner).
        for(const name of names) {
            const c = r.reward[name]?.counts;
            if(c) {
                agg.sumStronghold += c.strongholdBroken;
                agg.sumProvinces += c.provincesBroken;
                agg.sumConflicts += c.conflictsWon;
            }
        }
        if(out) {
            out.write(JSON.stringify(r) + '\n');
        }
        if(!args.quiet) {
            process.stdout.write(`game ${i + 1}/${args.count}: winner=${r.winner || '-'} reason=${r.winReason || r.stopReason} rounds=${r.rounds} ${r.elapsedMs}ms\n`);
        }
    }
    if(out) {
        out.end();
    }

    const g = agg.games || 1;
    console.log('\n===== self-play summary =====');
    console.log(`games=${agg.games} decided=${agg.decided} errors=${agg.errors} wallclock=${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`avg rounds=${(agg.sumRounds / g).toFixed(1)} avg steps=${(agg.sumSteps / g).toFixed(0)} avg ms/game=${(agg.sumMs / g).toFixed(0)}`);
    console.log(`wins: ${JSON.stringify(agg.winsByName)}`);
    console.log(`win reasons: ${JSON.stringify(agg.winReasons)}`);
    console.log(`stop reasons: ${JSON.stringify(agg.stopReasons)}`);
    console.log(`per-game events (both seats): stronghold=${(agg.sumStronghold / g).toFixed(2)} provinces=${(agg.sumProvinces / g).toFixed(2)} conflictsWon=${(agg.sumConflicts / g).toFixed(2)}`);
    if(out) {
        console.log(`trajectories -> ${path.resolve(args.out)}`);
    }
}

main().catch((err) => {
    console.error('runGames failed:', err);
    process.exit(1);
});
