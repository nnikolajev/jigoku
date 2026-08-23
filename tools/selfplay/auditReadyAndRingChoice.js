'use strict';
// FIRING CENSUS for the two 2026-08-23 Dragon-monk-replay fixes.
//
// Both levers sit far below the win-rate noise floor by construction — the
// measured ceilings are 0.55pp (`readyValue`) and 0.74pp (`defenderRingChoice`)
// — so the question a measurement has to answer is not "how much did it win",
// it is "did it fire, on what, and did it choose the right thing".
//
// This runs the ordinary cross-deck field with `BotTelemetry` attached and
// reports:
//
//   ready-value           every DECISION at which the policy would refuse a
//                         home ready. One row per decide() call, not per
//                         card: the verdict is memoised per decision and
//                         recorded only when it comes back false, so this is
//                         the size of the window the gate covers -- an upper
//                         bound on plays actually withheld
//   defender-ring-choice  every Togashi Tadakatsu ring handed over, with the
//                         fate given away against the largest pile on the table
//
// USAGE
//   BASES=91001,92001 node tools/selfplay/auditReadyAndRingChoice.js
//   BASES=<csv>   shuffle bases (default 91001)
//   DECKS=<csv>   restrict to these deck labels
//   FULL=1        every ordered cross-deck pairing instead of the ring
process.env.LOG_LEVEL = 'error';

const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { BotTelemetry } = require('../../build/server/game/bots/BotTelemetry.js');

const BASES = String(process.env.BASES || '91001').split(',').map(Number);
const ONLY = String(process.env.DECKS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FULL = process.env.FULL === '1';
const DECKS = ONLY.length > 0 ? ONLY : DECK_LABELS;

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

function bump(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function printCounts(title, map) {
    console.log(`  ${title}`);
    if(map.size === 0) {
        console.log('    (none)');
        return;
    }
    for(const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(count).padStart(5)}  ${key}`);
    }
}

(async () => {
    const events = [];
    let games = 0;
    for(const base of BASES) {
        for(let i = 0; i < DECK_LABELS.length; i++) {
            const deckA = DECK_LABELS[i];
            const opponents = FULL
                ? DECK_LABELS.filter((label) => label !== deckA)
                : [DECK_LABELS[(i + 1) % DECK_LABELS.length]];
            for(const deckB of opponents) {
                if(deckA === deckB) {
                    continue;
                }
                if(!DECKS.includes(deckA) && !DECKS.includes(deckB)) {
                    continue;
                }
                const j = DECK_LABELS.indexOf(deckB);
                const real = Math.random;
                Math.random = rng(base + (i * 100 + j) * 97);
                BotTelemetry.attach((event) => {
                    if(['ready-value', 'defender-ring-choice', 'ready-move-plan'].includes(event.kind)) {
                        events.push(Object.assign({ deckA: deckA, deckB: deckB, base: base }, event));
                    }
                });
                try {
                    await runGame({
                        names: ['Seat0', 'Seat1'],
                        seeds: [1, 1],
                        deckA: getDeckLoader(deckA)(),
                        deckB: getDeckLoader(deckB)()
                    });
                    games++;
                } finally {
                    BotTelemetry.detach();
                    Math.random = real;
                }
            }
        }
    }

    const readyRows = events.filter((event) => event.kind === 'ready-value');
    const ringRows = events.filter((event) => event.kind === 'defender-ring-choice');
    const planRows = events.filter((event) => event.kind === 'ready-move-plan');

    console.log(`games=${games} bases=${BASES.join(',')}`);

    // BotTelemetry is a GLOBAL static sink and records BOTH seats, so this is
    // decisions across both bots, not one deck's.
    console.log(`\nready-value: ${readyRows.length} decisions would refuse a home ready ` +
        `(${(readyRows.length / Math.max(1, games)).toFixed(2)} per game, both seats)`);
    const readyReasons = new Map();
    const readyRounds = new Map();
    for(const row of readyRows) {
        bump(readyReasons, row.reason);
        bump(readyRounds, `round ${row.round}`);
    }
    printCounts('by reason', readyReasons);
    printCounts('by round', readyRounds);

    console.log(`\ndefender-ring-choice: ${ringRows.length} Tadakatsu rings handed over ` +
        `(${new Set(ringRows.map((row) => `${row.base}|${row.deckA}|${row.deckB}`)).size} games)`);
    const ringReasons = new Map();
    const ringElements = new Map();
    let avoidedFate = 0;
    let gaveFate = 0;
    for(const row of ringRows) {
        bump(ringReasons, row.reason);
        bump(ringElements, `${row.chosen} (${row.chosenFate} fate, ranking ${row.ranking})`);
        gaveFate += Number(row.fateHandedOver) || 0;
        avoidedFate += Math.max(0, (Number(row.maxFateAvailable) || 0) - (Number(row.fateHandedOver) || 0));
    }
    printCounts('by reason', ringReasons);
    printCounts('by ring handed over', ringElements);
    const planReasons = new Map();
    const planPairs = new Map();
    const planDecks = new Map();
    for(const row of planRows) {
        bump(planReasons, `${row.order} / ${row.stage}: ${row.reason}`);
        bump(planPairs, `${row.readySourceId || '(already ready)'} -> ${row.moveSourceId}`);
        bump(planDecks, `${row.deckA} vs ${row.deckB}`);
    }
    console.log(`\nready-move-plan: ${planRows.length} committed sequences ` +
        `(${new Set(planRows.map((row) => `${row.base}|${row.deckA}|${row.deckB}`)).size} games)`);
    printCounts('by stage and reason', planReasons);
    printCounts('by source pair', planPairs);
    printCounts('by pairing', planDecks);

    if(ringRows.length > 0) {
        console.log(`    fate handed to the attacker: ${gaveFate}`);
        console.log(`    fate DENIED (largest pile on the table minus what was given): ${avoidedFate}`);
    }
})();
