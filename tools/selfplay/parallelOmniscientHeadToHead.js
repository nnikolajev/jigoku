'use strict';
// PARALLEL OMNISCIENT HEAD-TO-HEAD.
//
// The question this rig answers: "does letting one seat see the opponent's
// hand and face-down provinces make it a harder opponent?" It is the same
// experiment shape as parallelHeadToHead.js — every ordered cross-deck pairing,
// mirrors excluded, each pairing played TWICE on the same shuffle with the
// treatment on opposite sides — with the treatment being the omniscient
// capability instead of (or as well as) an injected deck-profile knob.
//
// Deck strength and first player cancel by construction, so the baseline is a
// hard 50%.
//
// USAGE
//   OMNI=0 node tools/selfplay/parallelOmniscientHeadToHead.js     # NULL ARM
//   OMNI=1 node tools/selfplay/parallelOmniscientHeadToHead.js     # baseline
//   OMNI=2 CHANGE='{"deckProfile":{"omniscientThreatRealism":true}}' ...  # lever
//
//   OMNI=0|1|2      0 fair both seats (NULL ARM) | 1 omniscient on the treated
//                   seat only — "does seeing the hand help?" | 2 omniscient on
//                   BOTH seats, which isolates the injected CHANGE on top of
//                   omniscience and is how an omniscient LEVER is measured
//   CHANGE=<json>   profile injected into the treated seat
//   CONTROL=<json>  profile injected into the untreated seat (default none)
//   BASES=<csv>     independent shuffle bases. 3 to reject, 6+ to accept.
//   GPB=<n>         extra games per pair per base (each adds 2 games)
//   DECKS=<csv>     restrict the deck pool (default: every registered deck)
//   SEED=<n>        V1 policy class (default 1). NOT the shuffle.
//   WORKERS=<n>     forked processes; leave cores free for the wall-clock backstop
//   OUT=<path>      also write per-game rows as JSON
//
// THE NULL ARM IS MANDATORY. `OMNI=0 CHANGE=` must score exactly 50.00% with
// every base at n/2. Anything else means the rig is broken, not the lever.
process.env.LOG_LEVEL = 'error';
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DECK_LABELS } = require('./deckRegistry.js');

const CHANGE = process.env.CHANGE || '{}';
const CONTROL = process.env.CONTROL || '';
const OMNI = process.env.OMNI === undefined ? '1' : process.env.OMNI;
const BASES = String(process.env.BASES || '91001,92001,93001').split(',').map(Number);
const GPB = Number(process.env.GPB || 1);
const SEED = String(process.env.SEED || 1);
const LABEL = process.env.LABEL || (OMNI === '0' ? 'null' : 'omniscient');
const OUT = process.env.OUT || '';
const DECKS = process.env.DECKS
    ? String(process.env.DECKS).split(',').map((deck) => deck.trim()).filter(Boolean)
    : DECK_LABELS.slice();
const WORKERS = Number(process.env.WORKERS || Math.max(1, require('os').cpus().length - 4));

const unknown = DECKS.filter((deck) => !DECK_LABELS.includes(deck));
if(unknown.length > 0) {
    console.error(`unknown deck(s): ${unknown.join(', ')}`);
    process.exit(1);
}
// Decks are addressed by their index in DECK_LABELS so a restricted pool cannot
// renumber the shuffle stream relative to a full-pool run.
const IDX = DECKS.map((deck) => DECK_LABELS.indexOf(deck));

const tasks = [];
for(const base of BASES) {
    for(const i of IDX) {
        for(const j of IDX) {
            if(i !== j) {
                tasks.push({ base: base, i: i, j: j });
            }
        }
    }
}

const shards = Array.from({ length: WORKERS }, () => []);
tasks.forEach((task, idx) => shards[idx % WORKERS].push(task));

const runShard = (shard, idx) => new Promise((resolve, reject) => {
    if(shard.length === 0) {
        return resolve({ rows: [], draws: 0, stops: {} });
    }
    const child = fork(path.join(__dirname, '_omniH2hWorker.js'), [], {
        env: Object.assign({}, process.env, {
            CHANGE: CHANGE,
            CONTROL: CONTROL,
            OMNI: OMNI,
            SEED: SEED,
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
        const line = out.split('\n').find((entry) => entry.startsWith('@@RESULT@@'));
        if(!line) {
            return reject(new Error(`worker ${idx} produced no result line: ${out.slice(-400)}`));
        }
        try {
            resolve(JSON.parse(line.slice('@@RESULT@@'.length)));
        } catch {
            reject(new Error(`worker ${idx} bad output: ${line.slice(0, 400)}`));
        }
    });
});

(async () => {
    const started = Date.now();
    const results = await Promise.all(shards.map(runShard));
    const rows = results.flatMap((result) => result.rows);
    const draws = results.reduce((sum, result) => sum + result.draws, 0);
    const stops = {};
    for(const result of results) {
        for(const [key, value] of Object.entries(result.stops)) {
            stops[key] = (stops[key] || 0) + value;
        }
    }

    const changedWins = rows.reduce((sum, row) => sum + row.changedWon, 0);
    const n = rows.length;
    const controlWins = n - changedWins;
    const pct = n > 0 ? 100 * changedWins / n : 0;
    const z = n > 0 ? (changedWins - n / 2) / Math.sqrt(n / 4) : 0;
    const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));

    console.log(`LABEL=${LABEL} OMNI=${OMNI} SEED=${SEED} CHANGE=${CHANGE}${CONTROL ? ` CONTROL=${CONTROL}` : ''}`);
    console.log(`decks=${DECKS.length} bases=${BASES.join(',')} gamesPerPairPerBase=${GPB * 2} ` +
        `workers=${WORKERS} draws=${draws} wall=${((Date.now() - started) / 60000).toFixed(1)}min`);
    console.log(`TREATED ${changedWins}-${controlWins} of ${n}  ${pct.toFixed(2)}%  ` +
        `(${(pct - 50).toFixed(2)}pp vs the 50% a no-op must score)  z=${z.toFixed(2)} p=${p.toFixed(3)}`);
    console.log(`stopReasons ${JSON.stringify(stops)}`);
    console.log('');
    console.log('per base');
    for(const base of BASES) {
        const slice = rows.filter((row) => row.base === base);
        if(slice.length === 0) {
            continue;
        }
        const wins = slice.reduce((sum, row) => sum + row.changedWon, 0);
        console.log(`  ${base}  ${wins}-${slice.length - wins}  ${(100 * wins / slice.length).toFixed(2)}%  ` +
            `${(100 * wins / slice.length - 50).toFixed(2)}pp`);
    }
    console.log('');
    console.log('per deck piloted by the TREATED side (deck STRENGTH, not effect — ' +
        'difference against a null arm before reading these)');
    for(const deck of DECKS) {
        const slice = rows.filter((row) => row.deck === deck);
        if(slice.length === 0) {
            continue;
        }
        const wins = slice.reduce((sum, row) => sum + row.changedWon, 0);
        console.log(`  ${deck.padEnd(20)} ${String(wins).padStart(4)}/${String(slice.length).padStart(4)}  ` +
            `${(100 * wins / slice.length).toFixed(1)}%  ${(100 * wins / slice.length - 50).toFixed(1)}pp`);
    }
    if(OUT) {
        fs.writeFileSync(OUT, JSON.stringify({
            label: LABEL, omni: OMNI, seed: SEED, change: CHANGE, control: CONTROL,
            bases: BASES, decks: DECKS, rows: rows
        }));
        console.log(`\nrows -> ${OUT}`);
    }
})().catch((error) => { console.error(error); process.exit(1); });

function erf(x) {
    const t = 1 / (1 + 0.3275911 * x);
    return 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
        0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
}
