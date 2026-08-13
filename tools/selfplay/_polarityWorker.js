'use strict';
// Worker for auditEffectPolarity.js. Plays each assigned pairing with an
// EffectPolarityMonitor attached to the live game and returns every wrong-side
// ready/bow/honor/dishonor landing.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { EffectPolarityMonitor } = require('../../test/helpers/effectpolarity.js');
const { seatAllowancesFor, allowancesWithKnownDefects } = require('../../test/helpers/polarityallowances.js');

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

const TASKS = JSON.parse(process.env.TASKS || '[]');
// RAW=1 turns the curated allowance list off, which is how a fresh exception
// list is derived: every wrong-side landing comes back, including the ones
// already understood.
const RAW = process.env.RAW === '1';

(async () => {
    const violations = [];
    const exempt = [];
    const totals = { games: 0, ready: 0, bow: 0, honor: 0, dishonor: 0 };
    for(const task of TASKS) {
        const { base, i, j } = task;
        const A = DECK_LABELS[i];
        const B = DECK_LABELS[j];
        const shuffle = base + (i * 100 + j) * 97;
        Math.random = rng(shuffle);
        let monitor = null;
        let controllers = [];
        const result = await runGame({
            names: ['Seat0', 'Seat1'],
            seeds: [1, 1],
            deckA: getDeckLoader(A)(),
            deckB: getDeckLoader(B)(),
            onControllers: (created) => {
                controllers = created;
            },
            onGame: (game) => {
                monitor = new EffectPolarityMonitor(game, {
                    label: `${base}|${A}|${B}`,
                    controllers: controllers,
                    seats: {
                        Seat0: { deck: A, allow: RAW ? [] : seatAllowancesFor(A) },
                        Seat1: { deck: B, allow: RAW ? [] : seatAllowancesFor(B) }
                    },
                    allowances: RAW ? {} : allowancesWithKnownDefects()
                });
            }
        });
        if(monitor) {
            monitor.detach();
            violations.push(...monitor.violations);
            exempt.push(...monitor.exempt.map((entry) => ({
                sourceId: entry.sourceId, action: entry.action,
                landedOn: entry.landedOn, exemption: entry.exemption
            })));
            totals.games++;
            for(const key of ['ready', 'bow', 'honor', 'dishonor']) {
                totals[key] += monitor.landings[key];
            }
        }
        if(result.error) {
            process.stderr.write(`game ${base}|${A}|${B} errored: ${String(result.error).slice(0, 200)}\n`);
        }
    }
    process.stdout.write('\n@@RESULT@@' + JSON.stringify({
        violations: violations, exempt: exempt, totals: totals
    }) + '\n');
})().catch((e) => {
    process.stderr.write(String(e && e.stack || e) + '\n');
    process.exit(1);
});
