'use strict';
// Worker for probeOmniscient.js. Plays each assigned pairing TWICE on one
// shuffle — once with both seats fair, once with the treated seat omniscient —
// with BotTelemetry attached, and returns every decision event plus both
// outcomes.
//
// Both arms run the V1 engine, the same path parallelOmniscientHeadToHead.js
// uses, so a ceiling measured here is the ceiling of the arm that rig scores.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { BotTelemetry } = require('../../build/server/game/bots/BotTelemetry.js');

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const CHANGE = JSON.parse(process.env.CHANGE || '{}');
const CONTROL = process.env.CONTROL ? JSON.parse(process.env.CONTROL) : undefined;
// Omniscience on the treated seat. OMNI=0 makes this a pure profile A/B, which
// is how the null arm is produced.
const OMNI = process.env.OMNI !== '0';
// When set, the CONTROL arm is omniscient too, so the pair isolates the profile
// CHANGE on top of omniscience rather than omniscience itself.
const CONTROL_OMNI = process.env.CONTROL_OMNI === '1';
const TASKS = JSON.parse(process.env.TASKS || '[]');
const KINDS = new Set(String(process.env.KINDS || '').split(',').filter(Boolean));
const ARMS = String(process.env.ARMS || 'treated');
const SEAT = Number(process.env.SEAT || 0);

(async () => {
    const games = [];
    const events = [];
    for(const task of TASKS) {
        const { base, i, j } = task;
        const A = DECK_LABELS[i];
        const B = DECK_LABELS[j];
        const shuffle = base + (i * 100 + j) * 97;
        const outcome = {};
        for(const arm of ['control', 'treated']) {
            const collected = [];
            if(ARMS === 'both' || ARMS === arm) {
                BotTelemetry.attach((event) => {
                    if(KINDS.size === 0 || KINDS.has(event.kind)) {
                        collected.push(event);
                    }
                });
            }
            const omniOn = arm === 'treated' ? OMNI : CONTROL_OMNI;
            const profile = arm === 'treated' ? CHANGE : CONTROL;
            Math.random = rng(shuffle);
            const result = await runGame({
                names: ['Seat0', 'Seat1'],
                seeds: [1, 1],
                deckA: getDeckLoader(A)(),
                deckB: getDeckLoader(B)(),
                omniscient: [omniOn && SEAT === 0, omniOn && SEAT === 1],
                v2Profiles: [SEAT === 0 ? profile : undefined, SEAT === 1 ? profile : undefined]
            });
            BotTelemetry.detach();
            outcome[arm] = {
                winner: result.winner,
                rounds: result.rounds,
                reason: String(result.winReason || ''),
                stop: result.stopReason
            };
            const gameKey = `${base}|${A}|${B}`;
            for(const event of collected) {
                events.push(Object.assign({ game: gameKey, arm: arm, deckA: A, deckB: B, base: base }, event));
            }
        }
        games.push({
            base: base,
            game: `${base}|${A}|${B}`,
            deckA: A,
            deckB: B,
            treatedDeck: SEAT === 0 ? A : B,
            control: outcome.control,
            treated: outcome.treated
        });
    }
    process.stdout.write('\n@@RESULT@@' + JSON.stringify({ games: games, events: events }) + '\n');
})().catch((error) => { process.stderr.write(String(error && error.stack || error) + '\n'); process.exit(1); });
