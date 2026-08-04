'use strict';
// PAIRED TELEMETRY PROBE — the "what actually happens" half of a measurement.
//
// A head-to-head answers "did the win rate move". It never answers "what did
// the bot do differently", and without that a rejected lever cannot be told
// apart from a MISAIMED one: both read ~50%. This plays every pairing twice on
// one shuffle — control, then the change on seat 0 — with BotTelemetry
// attached, and dumps the decision events next to both outcomes.
//
// It also yields the decisiveness ceiling for free, since it already has the
// control and treated winner for the same shuffle.
//
// USAGE
//   CHANGE='{"deckProfile":{"defenseBreakTie":true}}' KINDS=defense-size \
//     BASES=91001 WORKERS=14 OUT=probe.json node tools/selfplay/probePaired.js
//
//   KINDS=<csv>   telemetry kinds to keep (empty = all; there are a LOT)
//   ARMS=treated|control|both   which arm's events to collect (default treated)
//   SEAT=0|1      which seat carries the change (default 0)
//   OUT=<path>    write {games, events} for an analysis script to read
//
// WARNING — this rig treats ONE seat and therefore does NOT cancel a seat or
// first-player interaction, which the head-to-head does by construction. Its
// estimate is a HYPOTHESIS about the size of an effect, not the answer. Run
// SEAT=0 and SEAT=1 and compare before believing one. A measured example: the
// opponent-aware conflict axis read +4.07pp here (45 flips to / 23 away,
// p=0.0055) and +0.46pp on the head-to-head over four times the games.
process.env.LOG_LEVEL = 'error';
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DECK_LABELS } = require('./deckRegistry.js');

const CHANGE = process.env.CHANGE || '{}';
const BASES = String(process.env.BASES || '91001').split(',').map(Number);
const KINDS = process.env.KINDS || '';
const ARMS = process.env.ARMS || 'treated';
const OUT = process.env.OUT || '';
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
const shards = Array.from({ length: WORKERS }, () => []);
tasks.forEach((task, idx) => shards[idx % WORKERS].push(task));

const runShard = (shard, idx) => new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, '_probeWorker.js'), [], {
        env: Object.assign({}, process.env, {
            CHANGE: CHANGE,
            TASKS: JSON.stringify(shard),
            KINDS: KINDS,
            ARMS: ARMS,
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
        process.stderr.write(`worker ${idx} done\n`);
        const line = out.split('\n').find((l) => l.startsWith('@@RESULT@@'));
        if(!line) {
            return reject(new Error(`worker ${idx} produced no result line: ${out.slice(-400)}`));
        }
        resolve(JSON.parse(line.slice('@@RESULT@@'.length)));
    });
});

(async () => {
    const started = Date.now();
    const results = await Promise.all(shards.map(runShard));
    const games = results.flatMap((r) => r.games);
    const events = results.flatMap((r) => r.events);

    const treatedSeatName = `Seat${Number(process.env.SEAT || 0)}`;
    let flipped = 0;
    let flippedToTreated = 0;
    let pathChanged = 0;
    for(const game of games) {
        if(game.control.winner !== game.treated.winner) {
            flipped++;
            if(game.treated.winner === treatedSeatName) {
                flippedToTreated++;
            }
        } else if(game.control.rounds !== game.treated.rounds ||
            game.control.reason !== game.treated.reason) {
            pathChanged++;
        }
    }
    const pct = (n) => `${(100 * n / games.length).toFixed(1)}%`;
    console.log(`CHANGE=${CHANGE} bases=${BASES.join(',')} games=${games.length} ` +
        `events=${events.length} wall=${((Date.now() - started) / 60000).toFixed(1)}min`);
    console.log(`  winner flipped              ${flipped} (${pct(flipped)})  ` +
        `-> to changed seat ${flippedToTreated}, away ${flipped - flippedToTreated}`);
    console.log(`  same winner, different path ${pathChanged} (${pct(pathChanged)})`);
    console.log(`  game completely unchanged   ${games.length - flipped - pathChanged} ` +
        `(${pct(games.length - flipped - pathChanged)})`);
    console.log(`  CEILING: flipping ${pct(flipped)} of games caps the win-rate effect at ` +
        `${(50 * flipped / games.length).toFixed(2)}pp.`);
    if(OUT) {
        fs.writeFileSync(OUT, JSON.stringify({ change: CHANGE, games: games, events: events }));
        console.log(`\n-> ${OUT}`);
    }
})().catch((e) => { console.error(e); process.exit(1); });
