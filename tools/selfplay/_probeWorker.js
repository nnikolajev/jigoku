'use strict';
// Worker for probePaired.js. Plays each assigned pairing TWICE on one shuffle —
// once with both seats on the control profile, once with the change on seat 0 —
// with BotTelemetry attached, and returns every decision event plus both
// outcomes.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { BotTelemetry } = require('../../build/server/game/bots/BotTelemetry.js');

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const CHANGE = JSON.parse(process.env.CHANGE || '{}');
const TASKS = JSON.parse(process.env.TASKS || '[]');
const KINDS = new Set(String(process.env.KINDS || '').split(',').filter(Boolean));
// Events are the point of this probe but there are thousands per game; keep the
// payload sane by only forwarding the kinds asked for, and only from the arm
// asked for (`both` when the control's own population matters).
const ARMS = String(process.env.ARMS || 'treated');
// Which seat carries the change. This rig treats ONE seat, so unlike the
// head-to-head it does NOT cancel a seat/first-player interaction. Run it both
// ways before believing a paired estimate.
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
            let collected = [];
            const collecting = ARMS === 'both' || ARMS === arm;
            if(collecting) {
                BotTelemetry.attach((event) => {
                    if(KINDS.size === 0 || KINDS.has(event.kind)) {
                        collected.push(event);
                    }
                });
            }
            Math.random = rng(shuffle);
            const result = await runGame({
                names: ['Seat0', 'Seat1'],
                seeds: [1, 1],
                deckA: getDeckLoader(A)(),
                deckB: getDeckLoader(B)(),
                engineVersions: ['v2', 'v2'],
                v2Modes: ['pass-through', 'pass-through'],
                v2Profiles: [
                    arm === 'treated' && SEAT === 0 ? CHANGE : undefined,
                    arm === 'treated' && SEAT === 1 ? CHANGE : undefined
                ]
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
            control: outcome.control,
            treated: outcome.treated
        });
    }
    process.stdout.write('\n@@RESULT@@' + JSON.stringify({ games: games, events: events }) + '\n');
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
