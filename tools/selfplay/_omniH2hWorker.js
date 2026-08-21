'use strict';
// Worker process for parallelOmniscientHeadToHead.js. Runs one SHARD of the
// ordered cross-deck sweep and prints a single JSON line on stdout.
//
// Same sharding contract as _h2hWorker.js: a shard is a slice of the flattened
// (base, i, j) list, so it cannot change WHICH games are played or their
// shuffles. The treated seat is the one holding the omniscient capability
// (OMNI=1) and/or the injected CHANGE profile.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const CHANGE = JSON.parse(process.env.CHANGE || '{}');
const CONTROL = process.env.CONTROL ? JSON.parse(process.env.CONTROL) : undefined;
// OMNI=0 fair on both seats (null arm) | 1 omniscient on the treated seat only
// (does omniscience help?) | 2 omniscient on BOTH seats (isolates the injected
// CHANGE on top of omniscience, which is how an omniscient LEVER is A/B'd).
const OMNI = String(process.env.OMNI === undefined ? '1' : process.env.OMNI);
const omniFor = (seat, changedSeat) => OMNI === '2' || (OMNI === '1' && seat === changedSeat);
const TASKS = JSON.parse(process.env.TASKS || '[]');
const GPB = Number(process.env.GPB || 1);
const SEED = Number(process.env.SEED || 1);

(async () => {
    const rows = [];
    let draws = 0;
    let stops = {};
    for(const task of TASKS) {
        const { base, i, j } = task;
        const A = DECK_LABELS[i];
        const B = DECK_LABELS[j];
        for(let g = 0; g < GPB; g++) {
            const shuffle = base + (i * 100 + j) * 97 + g;
            for(const changedSeat of [0, 1]) {
                Math.random = rng(shuffle);
                const result = await runGame({
                    names: ['Seat0', 'Seat1'],
                    seeds: [SEED, SEED],
                    deckA: getDeckLoader(A)(),
                    deckB: getDeckLoader(B)(),
                    omniscient: [omniFor(0, changedSeat), omniFor(1, changedSeat)],
                    v2Profiles: [
                        changedSeat === 0 ? CHANGE : CONTROL,
                        changedSeat === 1 ? CHANGE : CONTROL
                    ]
                });
                stops[result.stopReason] = (stops[result.stopReason] || 0) + 1;
                const winnerSeat = result?.winner === 'Seat0' ? 0
                    : result?.winner === 'Seat1' ? 1 : -1;
                if(winnerSeat === -1) {
                    draws++;
                    continue;
                }
                rows.push({
                    base: base,
                    deck: changedSeat === 0 ? A : B,
                    opponent: changedSeat === 0 ? B : A,
                    changedWon: winnerSeat === changedSeat ? 1 : 0,
                    rounds: result.rounds,
                    reason: String(result.winReason || '')
                });
            }
        }
    }
    process.stdout.write('\n@@RESULT@@' +
        JSON.stringify({ rows: rows, draws: draws, stops: stops }) + '\n');
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
