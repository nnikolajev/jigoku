'use strict';
// PARALLEL DIRECT HEAD-TO-HEAD — same experiment as headToHeadRoundRobin.js,
// sharded across worker processes.
//
// The serial rig answers the right question but costs ~50 minutes per 540
// games, which puts the sample size needed to resolve a 1pp effect (~7800
// games) out of reach. This one splits the flattened (base, deckA, deckB) work
// list into contiguous shards and forks one worker per shard.
//
// Sharding cannot change which games are played, their shuffles, or their
// pairing with the opposite-orientation replay — a shard is a slice of the same
// list, and each (base,i,j) cell carries both orientations. So the null-arm
// guarantee survives: injecting a knob at its own default must still score
// exactly 50.00%. VERIFY THAT before trusting any arm from this script.
//
// USAGE
//   CHANGE='{"deckProfile":{"someKnob":1}}' BASES=91001,92001,93001 \
//     WORKERS=14 node tools/selfplay/parallelHeadToHead.js
//
//   CHANGE=<json>   the treated seat's injected V2 profile
//   CONTROL=<json>  the untreated seat's profile (default: none). Use this to
//                   hold a second knob on BOTH sides while A/B-ing a third.
//   BASES=<csv>     independent shuffle bases. 3 to reject, 6+ to accept.
//   GPB=<n>         extra games per pair per base (each adds 2 games)
//   WORKERS=<n>     forked processes. Leave headroom: the harness has a
//                   WALL-CLOCK per-game backstop, so oversubscribing the CPU
//                   turns slow games into non-results.
//   OUT=<path>      also write the per-game rows as JSON for later analysis
//
// Prints the same report as the serial script plus a binomial z/p on the total
// and a stopReason census — a run with timeouts in it is reporting fewer games
// than it played, and those are not missing at random.
process.env.LOG_LEVEL = 'error';
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DECK_LABELS } = require('./deckRegistry.js');

const CHANGE = process.env.CHANGE || '{}';
const CONTROL = process.env.CONTROL || '';
const BASES = String(process.env.BASES || '91001,92001,93001').split(',').map(Number);
const GPB = Number(process.env.GPB || 1);
const LABEL = process.env.LABEL || 'change';
const OUT = process.env.OUT || '';
// One worker per core minus a couple leaves the harness' wall-clock backstop
// (HARNESS_MAX_GAME_MS) room to be about the GAME being slow rather than about
// the box being oversubscribed.
const WORKERS = Number(process.env.WORKERS || Math.max(1, require('os').cpus().length - 4));

const tasks = [];
for(const base of BASES) {
    for(let i = 0; i < DECK_LABELS.length; i++) {
        for(let j = 0; j < DECK_LABELS.length; j++) {
            if(i !== j) {
                tasks.push({ base: base, i: i, j: j });
            }
        }
    }
}

// Contiguous slices, round-robin dealt so every worker gets a mix of decks and
// no single worker draws all of the slow body-heavy pairings.
const shards = Array.from({ length: WORKERS }, () => []);
tasks.forEach((task, idx) => shards[idx % WORKERS].push(task));

const runShard = (shard, idx) => new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, '_h2hWorker.js'), [], {
        env: Object.assign({}, process.env, {
            CHANGE: CHANGE,
            CONTROL: CONTROL,
            TASKS: JSON.stringify(shard),
            GPB: String(GPB),
            HARNESS_MAX_GAME_MS: process.env.HARNESS_MAX_GAME_MS || '180000'
        }),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => process.stderr.write(`w${idx}: ${chunk}`));
    child.on('exit', (code) => {
        if(code !== 0) {
            return reject(new Error(`worker ${idx} exited ${code}`));
        }
        process.stderr.write(`worker ${idx} done (${shard.length} pairings)\n`);
        const line = out.split('\n').find((l) => l.startsWith('@@RESULT@@'));
        if(!line) {
            return reject(new Error(`worker ${idx} produced no result line: ${out.slice(-400)}`));
        }
        try {
            resolve(JSON.parse(line.slice('@@RESULT@@'.length)));
        } catch(e) {
            reject(new Error(`worker ${idx} bad output: ${line.slice(0, 400)}`));
        }
    });
});

(async () => {
    const started = Date.now();
    const results = await Promise.all(shards.map(runShard));
    const rows = results.flatMap((r) => r.rows);
    const draws = results.reduce((sum, r) => sum + r.draws, 0);
    const stops = {};
    for(const r of results) {
        for(const [key, value] of Object.entries(r.stops)) {
            stops[key] = (stops[key] || 0) + value;
        }
    }

    const changedWins = rows.reduce((sum, row) => sum + row.changedWon, 0);
    const n = rows.length;
    const controlWins = n - changedWins;
    const pct = n > 0 ? 100 * changedWins / n : 0;
    // Binomial against p=0.5. The pairing structure makes 50% the exact null,
    // so this is the right test on the TOTAL (per-deck rows are not).
    const z = n > 0 ? (changedWins - n / 2) / Math.sqrt(n / 4) : 0;
    const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));

    console.log(`LABEL=${LABEL} CHANGE=${CHANGE}${CONTROL ? ` CONTROL=${CONTROL}` : ''}`);
    console.log(`bases=${BASES.join(',')} gamesPerPairPerBase=${GPB * 2} ` +
        `workers=${WORKERS} draws=${draws} wall=${((Date.now() - started) / 60000).toFixed(1)}min`);
    console.log(`CHANGED ${changedWins}-${controlWins} of ${n}  ${pct.toFixed(2)}%  ` +
        `(${(pct - 50).toFixed(2)}pp vs the 50% a no-op must score)  z=${z.toFixed(2)} p=${p.toFixed(3)}`);
    console.log(`stopReasons ${JSON.stringify(stops)}`);
    console.log('');
    console.log('per base');
    for(const base of BASES) {
        const slice = rows.filter((row) => row.base === base);
        const w = slice.reduce((sum, row) => sum + row.changedWon, 0);
        console.log(`  ${base}  ${w}-${slice.length - w}  ${(100 * w / slice.length).toFixed(2)}%  ` +
            `${(100 * w / slice.length - 50).toFixed(2)}pp`);
    }
    console.log('');
    console.log('per deck piloted by the CHANGED side (deck STRENGTH, not effect — ' +
        'difference against a null arm before reading these)');
    for(const deck of DECK_LABELS) {
        const slice = rows.filter((row) => row.deck === deck);
        if(slice.length === 0) {
            continue;
        }
        const w = slice.reduce((sum, row) => sum + row.changedWon, 0);
        console.log(`  ${deck.padEnd(20)} ${String(w).padStart(4)}/${String(slice.length).padStart(4)}  ` +
            `${(100 * w / slice.length).toFixed(1)}%  ${(100 * w / slice.length - 50).toFixed(1)}pp`);
    }
    if(OUT) {
        fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, change: CHANGE, control: CONTROL, rows: rows }));
        console.log(`\nrows -> ${OUT}`);
    }
})().catch((e) => { console.error(e); process.exit(1); });

function erf(x) {
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
        0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return y;
}
