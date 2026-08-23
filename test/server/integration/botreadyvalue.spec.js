'use strict';

// GENERIC BOT READY-VALUE INVARIANT, measured in real games.
//
// Not a card unit test: every deck plays complete headless self-play games and
// a ReadyValueMonitor watches the engine's own `onCardReadied` events as they
// resolve. Whatever the card, whatever the deck overlay, one invariant holds:
//
//   the bot never spends a card readying a body that NOTHING can use.
//
// "Nothing can use it" is judged at the instant of the ready and is deliberately
// narrow, so the assertion is about the bot and not about the opponent's later
// choices: the body was not in a conflict, and NEITHER player had a conflict
// opportunity remaining. No later event could have used that ready.
//
// Everything softer is counted and printed, never failed:
//   * a ready made while an opportunity remained that nothing in fact used —
//     the opponent may simply have passed;
//   * a ready the opponent then declined to attack into. That one is credited
//     as `deterred`, because a conflict they were able to declare and did not
//     is exactly what a standing defender buys;
//   * a dead ready produced by a free RING resolution. A claimed ring resolves
//     whether the bot wants it to or not, so it costs no card and no fate. The
//     bot demotes a dead ready below every live ring option; it cannot decline
//     the ring.
//
// Scaling knobs (default is one game per deck per seat, ~1 minute):
//   READY_BASES=91001,92001   shuffle bases to play
//   READY_DECKS=Crane,Lion    restrict to these decks
//   READY_FULL=1              every ordered cross-deck pairing (slow)

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('../../../tools/selfplay/harness.js');
const { BotTelemetry } = require('../../../build/server/game/bots/BotTelemetry.js');
const { DECK_LABELS, getDeckLoader } = require('../../../tools/selfplay/deckRegistry.js');
const { ReadyValueMonitor, formatReadies } = require('../../helpers/readyvalue.js');
const { MoveValueMonitor, formatMoves } = require('../../helpers/movevalue.js');
const {
    KNOWN_READY_DEFECTS, KNOWN_MOVE_DEFECTS, readyDefectIds, moveDefectIds
} = require('../../helpers/readymoveallowances.js');

const BASES = String(process.env.READY_BASES || '91001').split(',').map(Number);
const ONLY = String(process.env.READY_DECKS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FULL = process.env.READY_FULL === '1';
const DECKS = ONLY.length > 0 ? ONLY : DECK_LABELS;

// The Imperial Favor exception, mirrored from `DeckProfile.readyValue`. The
// glory count that awards the favor at the end of the conflict phase reads only
// UNBOWED characters, so for a deck that races the favor an unused ready is
// still points. Keep this list in step with the profiles that set
// `readyValue.countFavorGlory`.
const FAVOR_GLORY_DECKS = new Set(['ScorpionBidWar']);

function shuffleRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

async function playAndWatch(deckA, deckB, base) {
    const i = DECK_LABELS.indexOf(deckA);
    const j = DECK_LABELS.indexOf(deckB);
    const realRandom = Math.random;
    Math.random = shuffleRng(base + (i * 100 + j) * 97);
    let monitor = null;
    let moveMonitor = null;
    let controllers = [];
    // Direct evidence that the sequencer FIRES, independent of decision-reason
    // strings: `ReadyMovePlanner` records one row per committed plan.
    const planStages = { ready: 0, move: 0 };
    BotTelemetry.attach((event) => {
        if(event.kind === 'ready-move-plan' && planStages[event.stage] !== undefined) {
            planStages[event.stage]++;
        }
    });
    try {
        await runGame({
            names: ['Seat0', 'Seat1'],
            seeds: [1, 1],
            deckA: getDeckLoader(deckA)(),
            deckB: getDeckLoader(deckB)(),
            onControllers: (created) => {
                controllers = created;
            },
            onGame: (game) => {
                const seats = {
                    Seat0: { deck: deckA, favorGlory: FAVOR_GLORY_DECKS.has(deckA) },
                    Seat1: { deck: deckB, favorGlory: FAVOR_GLORY_DECKS.has(deckB) }
                };
                const label = `${base}|${deckA}|${deckB}`;
                monitor = new ReadyValueMonitor(game, { label, controllers, seats });
                moveMonitor = new MoveValueMonitor(game, { label, controllers, seats });
            }
        });
    } finally {
        Math.random = realRandom;
    }
    BotTelemetry.detach();
    monitor.detach();
    moveMonitor.detach();
    // Known-open defects are listed in `readymoveallowances.js`, not silenced:
    // the suites fail on anything NEW, which is the point of the gate.
    const openReady = new Set(readyDefectIds());
    const openMove = new Set(moveDefectIds());
    return {
        wasted: monitor.wasted.filter((entry) => !openReady.has(entry.sourceId)),
        unused: monitor.unused,
        counts: monitor.counts,
        moveWasted: moveMonitor.wasted.filter((entry) => !openMove.has(entry.sourceId)),
        plannedOutcomes: monitor.plannedOutcomes,
        knownOpen: monitor.wasted.filter((entry) => openReady.has(entry.sourceId)).length +
            moveMonitor.wasted.filter((entry) => openMove.has(entry.sourceId)).length,
        planStages,
        moveRedundant: moveMonitor.redundant,
        moveCounts: moveMonitor.counts
    };
}

describe('bot ready value (self-play field)', function() {
    let originalTimeout;

    beforeAll(function() {
        originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 15 * 60 * 1000;
    });

    afterAll(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    });

    const totals = {
        total: 0, participantReady: 0, usedLater: 0,
        deterred: 0, favorGlory: 0, freeRing: 0,
        plannedReady: 0, plannedReadyMoved: 0, readyAfterMove: 0
    };
    let knownOpenSeen = 0;
    const plansCommitted = { ready: 0, move: 0 };
    const plannedOutcomeCensus = new Map();
    const allUnused = [];
    const moveTotals = {
        total: 0, decisiveWin: 0, decisiveBreak: 0, decisiveDefence: 0,
        payoff: 0, redundant: 0, wasted: 0
    };
    const allRedundantMoves = [];
    // Every wasted move in every game this suite plays, whichever seat made it.
    // The per-deck gate below only sees the deck under test, and a deck only
    // plays its own pairings, so a defect on the opposing seat would otherwise
    // be counted in the totals and asserted by nobody.
    const allWastedMoves = [];

    DECKS.forEach(function(deck, index) {
        // Each deck answers for itself on BOTH seats: first player order changes
        // which conflicts the deck ever gets to declare, and the whole question
        // here is about conflict opportunities remaining.
        const opponents = FULL
            ? DECK_LABELS.filter((label) => label !== deck)
            : [DECK_LABELS[(index + 1) % DECK_LABELS.length]];

        it(`never readies a body no conflict can use: ${deck}`, async function() {
            const wasted = [];
            const wastedMoves = [];
            for(const base of BASES) {
                for(const opponent of opponents) {
                    if(opponent === deck) {
                        continue;
                    }
                    for(const [a, b] of [[deck, opponent], [opponent, deck]]) {
                        const result = await playAndWatch(a, b, base);
                        for(const key of Object.keys(totals)) {
                            totals[key] += result.counts[key];
                        }
                        for(const key of Object.keys(moveTotals)) {
                            moveTotals[key] += result.moveCounts[key];
                        }
                        knownOpenSeen += result.knownOpen;
                        for(const [key, count] of result.plannedOutcomes) {
                            plannedOutcomeCensus.set(key, (plannedOutcomeCensus.get(key) || 0) + count);
                        }
                        plansCommitted.ready += result.planStages.ready;
                        plansCommitted.move += result.planStages.move;
                        wasted.push(...result.wasted.filter((entry) => entry.deck === deck));
                        allUnused.push(...result.unused.filter((entry) => entry.deck === deck));
                        wastedMoves.push(...result.moveWasted.filter((entry) => entry.deck === deck));
                        allWastedMoves.push(...result.moveWasted);
                        allRedundantMoves.push(...result.moveRedundant.filter((entry) => entry.deck === deck));
                    }
                }
            }
            // The hard gate: at the moment of the ready, neither player had a
            // conflict opportunity left and the body was at home. Nothing could
            // have used it. Seen live before the gate shipped (Phoenix vs
            // Dragon 2026-08-23 r2c4: Against the Waves on Kudaka at home).
            expect(wasted.length).withContext(
                `${deck} readied a body with no conflict left to use it:\n${formatReadies(wasted)}`
            ).toBe(0);
            // The second leg: a body moved into a conflict has to bring
            // something. `wasted` here means it ended the conflict bowed, at 0
            // skill, with no participation payoff on the table -- it could not
            // have contributed whatever the opponent did afterwards.
            expect(wastedMoves.length).withContext(
                `${deck} moved a body into a conflict that could not contribute:` +
                    `\n${formatMoves(wastedMoves)}`
            ).toBe(0);
        });
    });

    it('exercised enough readies for the invariant to mean something', function() {
        // A green suite that never saw a ready is not evidence.
        expect(totals.total).toBeGreaterThan(10);
    });

    it('reports the soft cases rather than hiding them', function() {
        // Not an assertion about the bot. A ready made while an opportunity
        // remained is defensible even when nothing used it — the opponent's
        // pass is not the bot's mistake — but a rising count here is the first
        // sign that a gate has drifted.
        console.log(
            `ready value: ${totals.total} readies — ` +
            `${totals.participantReady} on bowed participants, ` +
            `${totals.usedLater} used by a later conflict, ` +
            `${totals.deterred} followed by an opponent pass, ` +
            `${totals.favorGlory} banked for the Imperial Favor, ` +
            `${totals.freeRing} dead readies off a free ring resolution, ` +
            `${allUnused.length} unused.`
        );
        if(allUnused.length > 0) {
            console.log(`unused readies (not a failure):\n${formatReadies(allUnused.slice(0, 20))}`);
        }
        expect(totals.total).toBeGreaterThan(0);
        // How often a ready ATTRIBUTED to the planner was completed by its
        // move. Not an equality: the plan is re-derived every prompt from a
        // board the opponent also acts on, so a move source can stop being
        // legal, a target can be removed, or the conflict can end between the
        // legs. `preferUuid` keeps the planner on the body it already paid for,
        // which is what makes the ratio high rather than perfect.
        //
        // A floor, not a target: if the second leg's gate or target picker
        // stops following the plan this collapses, which is the regression this
        // guards against.
        const completion = totals.plannedReady > 0
            ? totals.plannedReadyMoved / totals.plannedReady
            : 1;
        console.log(`ready -> move completion: ${totals.plannedReadyMoved}/${totals.plannedReady} ` +
            `(${(completion * 100).toFixed(0)}%); ` +
            `${totals.readyAfterMove} second legs of the move -> ready order.`);
        for(const [key, count] of [...plannedOutcomeCensus.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`    ${String(count).padStart(4)}  ${key}`);
        }
        expect(completion).withContext(
            `only ${totals.plannedReadyMoved} of ${totals.plannedReady} attributed ready legs ` +
            'were completed by their move'
        ).toBeGreaterThan(0.6);
    });

    it('reports what the bodies it MOVED into conflicts actually did', function() {
        const decisive = moveTotals.decisiveWin + moveTotals.decisiveBreak + moveTotals.decisiveDefence;
        console.log(
            `move value: ${moveTotals.total} bodies moved into a conflict - ` +
            `${moveTotals.decisiveWin} won the conflict, ` +
            `${moveTotals.decisiveBreak} produced the break, ` +
            `${moveTotals.decisiveDefence} stopped one, ` +
            `${moveTotals.payoff} paid off by participating, ` +
            `${moveTotals.redundant} redundant, ` +
            `${moveTotals.wasted} wasted.`
        );
        if(allRedundantMoves.length > 0) {
            console.log(`redundant moves (not a failure):` +
                `\n${formatMoves(allRedundantMoves.slice(0, 20))}`);
        }
        // A body arriving late is not guaranteed to matter - the opponent acts
        // after we do. But if NONE of them ever decides anything, the movement
        // machinery is not doing its job.
        expect(allWastedMoves.length).withContext(
            `bodies moved into a conflict that could not contribute:` +
            `\n${formatMoves(allWastedMoves)}`
        ).toBe(0);
        expect(moveTotals.total).withContext('no move was exercised at all').toBeGreaterThan(0);
        expect(decisive + moveTotals.payoff)
            .withContext('every move the field made was redundant')
            .toBeGreaterThan(0);
    });

    it('lists the open ready/move defects rather than hiding them', function() {
        // Not an assertion about the bot: a reminder that the suites above run
        // with an allowance list. Every entry predates ReadyValuePolicy and
        // ReadyMovePlanner and was FOUND by these suites; removing one is how a
        // fix gets locked in.
        const open = Object.entries(KNOWN_READY_DEFECTS)
            .concat(Object.entries(KNOWN_MOVE_DEFECTS))
            .map(([id, why]) => `${id}: ${why}`);
        console.log(`open ready/move defects (${knownOpenSeen} landings this run), ` +
            `see docs/bot-ready-move-sequence.md:`);
        for(const line of open) {
            console.log(`  ${line}`);
        }
        // The lists exist to be emptied, not grown.
        expect(open.length).toBeLessThanOrEqual(10);
    });

    it('commits ready -> move sequences, in both stages', function() {
        // Direct from `ReadyMovePlanner`'s own telemetry, so it does not depend
        // on a decision-reason string surviving to the ready event.
        console.log(`ready -> move planner: ${plansCommitted.ready} decisions at stage READY ` +
            `(a bowed body, both legs budgeted), ${plansCommitted.move} at stage MOVE.`);
        expect(plansCommitted.move)
            .withContext('the planner never committed to moving anybody')
            .toBeGreaterThan(0);
        expect(plansCommitted.ready)
            .withContext('the planner never committed to the ready -> move sequence')
            .toBeGreaterThan(0);
    });
});
