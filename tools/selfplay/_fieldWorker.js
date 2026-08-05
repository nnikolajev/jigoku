'use strict';
// Worker for deckFieldWinRate.js. Plays one SHARD of the (base, opponent)
// work list and prints a single JSON line on stdout.
//
// A shard is a slice of the same list, so sharding cannot change which games
// are played or their shuffles — only which process plays them.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { getDeckLoader } = require('./deckRegistry.js');

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

const SUBJECT = process.env.SUBJECT || 'PhoenixPhoenix';
const PROFILE = process.env.SUBJECT_PROFILE ? JSON.parse(process.env.SUBJECT_PROFILE) : undefined;
const TASKS = JSON.parse(process.env.TASKS || '[]');
const GPB = Number(process.env.GPB || 1);

(async () => {
    const rows = [];
    let draws = 0;
    const stops = {};
    for(const task of TASKS) {
        const { base, opponent, index } = task;
        for(let g = 0; g < GPB; g++) {
            const shuffle = base + index * 97 + g * 7919;
            // Both seats, same shuffle: first-player advantage cancels by
            // construction instead of being averaged away over many games.
            for(const subjectSeat of [0, 1]) {
                Math.random = rng(shuffle);
                const engineVersions = PROFILE ? ['v2', 'v2'] : ['v1', 'v1'];
                const result = await runGame({
                    names: ['Seat0', 'Seat1'],
                    seeds: [1, 1],
                    deckA: subjectSeat === 0 ? getDeckLoader(SUBJECT)() : getDeckLoader(opponent)(),
                    deckB: subjectSeat === 0 ? getDeckLoader(opponent)() : getDeckLoader(SUBJECT)(),
                    engineVersions,
                    v2Modes: PROFILE ? ['pass-through', 'pass-through'] : [],
                    v2Profiles: PROFILE
                        ? [subjectSeat === 0 ? PROFILE : undefined, subjectSeat === 1 ? PROFILE : undefined]
                        : []
                });
                stops[result.stopReason] = (stops[result.stopReason] || 0) + 1;
                const winnerSeat = result?.winner === 'Seat0' ? 0
                    : result?.winner === 'Seat1' ? 1 : -1;
                if(winnerSeat === -1) {
                    draws++;
                    continue;
                }
                rows.push({
                    base,
                    opponent,
                    subjectSeat,
                    subjectWon: winnerSeat === subjectSeat ? 1 : 0,
                    rounds: result.rounds,
                    reason: String(result.winReason || '')
                });
            }
        }
    }
    process.stdout.write('\n@@RESULT@@' + JSON.stringify({ rows, draws, stops }) + '\n');
})().catch((error) => {
    process.stderr.write(String((error && error.stack) || error) + '\n');
    process.exit(1);
});
