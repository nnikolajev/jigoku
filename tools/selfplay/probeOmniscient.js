'use strict';
// PAIRED OMNISCIENT PROBE — the "what actually changes" half of the omniscient
// measurement.
//
// The head-to-head answers "is the cheating seat a harder opponent". It never
// answers "what did seeing the hand make it DO", and without that a null result
// cannot be told apart from an inert one. This plays every pairing twice on one
// shuffle — fair, then omniscient on one seat — with BotTelemetry attached, and
// dumps the decision events next to both outcomes.
//
// It yields the decisiveness ceiling for free, and a per-deck CAUSAL number
// (only one seat is treated, so a flip IS that deck's effect).
//
// USAGE
//   KINDS=omni-use BASES=91001 OUT=probe.json node tools/selfplay/probeOmniscient.js
//
//   OMNI=0|1        omniscience on the treated seat (default 1)
//   CONTROL_OMNI=1  make the CONTROL arm omniscient too, so the pair isolates
//                   the profile CHANGE on top of omniscience
//   CHANGE=<json>   profile injected into the treated seat
//   CONTROL=<json>  profile injected into the control seat
//   KINDS=<csv>     telemetry kinds to keep (empty = all; there are a LOT)
//   ARMS=treated|control|both   which arm's events to collect (default treated)
//   SEAT=0|1        which seat carries the treatment (default 0)
//   ONLY=<csv>      keep only pairings where the TREATED seat pilots one of
//                   these decks (shuffle-safe: the shuffle is derived from the
//                   deck INDICES, so a pairing plays the same game either way)
//   OUT=<path>      write {games, events} for an analysis script
//
// WARNING — this rig treats ONE seat and therefore does NOT cancel a seat or
// first-player interaction, which the head-to-head does by construction. Run
// SEAT=0 and SEAT=1 and average before believing a paired estimate.
process.env.LOG_LEVEL = 'error';
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DECK_LABELS } = require('./deckRegistry.js');

const CHANGE = process.env.CHANGE || '{}';
const BASES = String(process.env.BASES || '91001').split(',').map(Number);
const OUT = process.env.OUT || '';
const WORKERS = Number(process.env.WORKERS || Math.max(1, require('os').cpus().length - 4));
const SEAT = Number(process.env.SEAT || 0);

const ONLY = String(process.env.ONLY || '').split(',').map((label) => label.trim()).filter(Boolean);
const unknown = ONLY.filter((label) => !DECK_LABELS.includes(label));
if(unknown.length > 0) {
    throw new Error(`ONLY names decks that do not exist: ${unknown.join(', ')}`);
}

const tasks = [];
for(const base of BASES) {
    for(let i = 0; i < DECK_LABELS.length; i++) {
        for(let j = 0; j < DECK_LABELS.length; j++) {
            const treatedDeck = DECK_LABELS[SEAT === 1 ? j : i];
            if(i !== j && (ONLY.length === 0 || ONLY.includes(treatedDeck))) {
                tasks.push({ base: base, i: i, j: j });
            }
        }
    }
}
const shards = Array.from({ length: WORKERS }, () => []);
tasks.forEach((task, idx) => shards[idx % WORKERS].push(task));

const runShard = (shard, idx) => new Promise((resolve, reject) => {
    if(shard.length === 0) {
        return resolve({ games: [], events: [] });
    }
    const child = fork(path.join(__dirname, '_omniProbeWorker.js'), [], {
        env: Object.assign({}, process.env, {
            CHANGE: CHANGE,
            TASKS: JSON.stringify(shard),
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
        const line = out.split('\n').find((entry) => entry.startsWith('@@RESULT@@'));
        if(!line) {
            return reject(new Error(`worker ${idx} produced no result line: ${out.slice(-400)}`));
        }
        resolve(JSON.parse(line.slice('@@RESULT@@'.length)));
    });
});

(async () => {
    const started = Date.now();
    const results = await Promise.all(shards.map(runShard));
    const games = results.flatMap((result) => result.games);
    const events = results.flatMap((result) => result.events);

    const treatedSeatName = `Seat${SEAT}`;
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
    const pct = (count) => `${(100 * count / Math.max(1, games.length)).toFixed(1)}%`;
    console.log(`OMNI=${process.env.OMNI || '1'} CONTROL_OMNI=${process.env.CONTROL_OMNI || '0'} ` +
        `CHANGE=${CHANGE} seat=${SEAT} bases=${BASES.join(',')}`);
    console.log(`games=${games.length} events=${events.length} ` +
        `wall=${((Date.now() - started) / 60000).toFixed(1)}min`);
    console.log(`  winner flipped              ${flipped} (${pct(flipped)})  ` +
        `-> to treated seat ${flippedToTreated}, away ${flipped - flippedToTreated}`);
    console.log(`  same winner, different path ${pathChanged} (${pct(pathChanged)})`);
    console.log(`  game completely unchanged   ${games.length - flipped - pathChanged} ` +
        `(${pct(games.length - flipped - pathChanged)})`);
    console.log(`  CEILING: flipping ${pct(flipped)} of games caps the win-rate effect at ` +
        `${(50 * flipped / Math.max(1, games.length)).toFixed(2)}pp.`);
    if(OUT) {
        // `seat` is written because it cannot be recovered from the dump:
        // telemetry records both players, so every dump holds Seat0 and Seat1
        // events either way and an analysis that guesses from the filename
        // silently swaps `to` and `away` on every game.
        fs.writeFileSync(OUT, JSON.stringify({
            change: CHANGE,
            omni: process.env.OMNI || '1',
            controlOmni: process.env.CONTROL_OMNI || '0',
            seat: SEAT,
            bases: BASES,
            games: games,
            events: events
        }));
        console.log(`\n-> ${OUT}`);
    }
})().catch((error) => { console.error(error); process.exit(1); });
