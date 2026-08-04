'use strict';
// REFACTOR IDENTITY: prove a code change that is supposed to change NOTHING
// changed nothing.
//
// Pulling a decision out into a class, renaming a knob, reordering a guard —
// these are all "obviously" behaviour-preserving until one of them silently
// isn't, and a win-rate rig cannot tell you: a null arm scores exactly 50.00%
// whether the refactor is faithful or not, because BOTH seats moved together.
//
// This runs a fixed slate of games and prints a hash of every outcome. Capture
// it before the refactor, run it again after, and the two must match exactly.
//
//   node tools/selfplay/refactorIdentity.js > before.txt   # then refactor
//   node tools/selfplay/refactorIdentity.js > after.txt
//   diff before.txt after.txt
process.env.LOG_LEVEL = 'error';
const crypto = require('crypto');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const BASE = Number(process.env.BASE || 77001);
const ENGINE = process.env.ENGINE || 'v1';

(async () => {
    const lines = [];
    for(let i = 0; i < DECK_LABELS.length; i++) {
        const j = (i + 1) % DECK_LABELS.length;
        const shuffle = BASE + i * 97;
        Math.random = rng(shuffle);
        const result = await runGame({
            names: ['Seat0', 'Seat1'],
            seeds: [1, 1],
            deckA: getDeckLoader(DECK_LABELS[i])(),
            deckB: getDeckLoader(DECK_LABELS[j])(),
            engineVersions: [ENGINE, ENGINE],
            v2Modes: ENGINE === 'v2' ? ['pass-through', 'pass-through'] : []
        });
        lines.push(`${DECK_LABELS[i]} vs ${DECK_LABELS[j]}  winner=${result.winner} ` +
            `rounds=${result.rounds} steps=${result.steps} reason=${result.winReason} ` +
            `stop=${result.stopReason}`);
    }
    for(const line of lines) {
        console.log(line);
    }
    console.log(`SHA ${crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)}`);
})().catch((e) => { console.error(e); process.exit(1); });
