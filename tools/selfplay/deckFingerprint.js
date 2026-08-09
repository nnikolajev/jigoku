'use strict';
// Deterministic CROSS-DECK REGRESSION fingerprint.
//
// A null arm cannot catch a refactor that moved BOTH seats together, and a win
// rate cannot prove a shared-card extraction left another deck alone. This
// plays a fixed, fully seeded list of games for one deck against the field and
// prints a hash plus the per-game rows, so the same command run on two builds
// answers "did this deck change at all?" with a diff.
//
// The seeding is exactly `_fieldWorker.js`'s: `runGame` has NO `rngSeed`
// option, so a shuffle is fixed by overriding the global `Math.random` before
// the call. A tool that passes `rngSeed` runs every game UNSEEDED and reports
// ~90% of games "changed" on an unchanged build (see docs/bot-crane-honor.md).
//
// USAGE
//   SUBJECT=LionDuelist GAMES=4 node tools/selfplay/deckFingerprint.js > before.txt
//   # ...change the code, rebuild with `npx tsc`...
//   SUBJECT=LionDuelist GAMES=4 node tools/selfplay/deckFingerprint.js > after.txt
//   diff before.txt after.txt
//
//   SUBJECT=<label>      deck under test (required)
//   GAMES=<n>            games per opponent (default 4, alternating seats)
//   BASE=<n>             shuffle base (default 91001)
//   EXCLUDE=<csv>        opponents to skip (e.g. a deck that does not exist on
//                        the other build — it would shift nothing else, because
//                        each pairing is seeded independently)
process.env.LOG_LEVEL = 'error';
const crypto = require('crypto');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const SUBJECT = process.env.SUBJECT || '';
const GAMES = Number(process.env.GAMES || 4);
const BASE = Number(process.env.BASE || 91001);
const EXCLUDE = new Set(String(process.env.EXCLUDE || '').split(',').filter(Boolean));

if(!DECK_LABELS.includes(SUBJECT)) {
    console.error(`Unknown subject deck ${SUBJECT}. Known: ${DECK_LABELS.join(', ')}`);
    process.exit(1);
}

(async () => {
    // Sorted and index-keyed off the OPPONENT NAME, not its position in the
    // registry, so adding a deck to the registry cannot reshuffle the games
    // played against the others.
    const opponents = DECK_LABELS
        .filter((label) => label !== SUBJECT && !EXCLUDE.has(label))
        .sort();
    const lines = [];
    for(const opponent of opponents) {
        let wins = 0;
        for(let g = 0; g < GAMES; g++) {
            const subjectSeat = g % 2;
            const shuffle = BASE + hash32(opponent) + g * 7919;
            Math.random = rng(shuffle);
            const result = await runGame({
                names: ['Seat0', 'Seat1'],
                seeds: [1, 1],
                deckA: subjectSeat === 0 ? getDeckLoader(SUBJECT)() : getDeckLoader(opponent)(),
                deckB: subjectSeat === 0 ? getDeckLoader(opponent)() : getDeckLoader(SUBJECT)(),
                engineVersions: ['v1', 'v1']
            });
            const winnerSeat = result?.winner === 'Seat0' ? 0 : result?.winner === 'Seat1' ? 1 : -1;
            const won = winnerSeat === subjectSeat ? 1 : 0;
            wins += won;
            lines.push(`${opponent}\tg${g}\tseat${subjectSeat}\twon=${won}\t` +
                `rounds=${result.rounds}\treason=${result.winReason || 'none'}\t` +
                `stop=${result.stopReason || 'none'}`);
        }
        lines.push(`# ${opponent}: ${wins}/${GAMES}`);
    }
    const body = lines.join('\n');
    console.log(body);
    console.log(`# FINGERPRINT ${SUBJECT} base=${BASE} games=${GAMES * opponents.length} ` +
        crypto.createHash('sha256').update(body).digest('hex').slice(0, 16));
})().catch((error) => {
    console.error((error && error.stack) || error);
    process.exit(1);
});

function hash32(text) {
    let h = 2166136261;
    for(let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 100000;
}
