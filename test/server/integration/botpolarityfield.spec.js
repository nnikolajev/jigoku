'use strict';

// GENERIC BOT TARGETING INVARIANT, measured in real games.
//
// Not a card unit test: every deck plays complete headless self-play games and
// an EffectPolarityMonitor watches the engine's own ready/bow/honor/dishonor
// events as they resolve. Whatever the card, whatever the deck overlay, the
// four invariants hold:
//
//   ready    -> our character        honor    -> our character
//   bow      -> their character      dishonor -> their character
//
// A misconfigured card, a deck overlay that hijacks another card's prompt, and
// a bot that clicks the first selectable card all show up here as a wrong-side
// landing, without anybody having to know the card existed.
//
// Costs, self-targeting effects, Scorpion's deliberate own-side dishonor and
// the printed two-sided cards in polarityallowances.js are exempt. The
// currently-open bot defects are listed there too, so this suite fails only on
// something NEW.
//
// Scaling knobs (default is one game per deck per seat, ~1 minute):
//   POLARITY_BASES=91001,92001   shuffle bases to play
//   POLARITY_DECKS=Crane,Lion    restrict to these decks
//   POLARITY_FULL=1              every ordered cross-deck pairing (slow)

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('../../../tools/selfplay/harness.js');
const { DECK_LABELS, getDeckLoader } = require('../../../tools/selfplay/deckRegistry.js');
const { EffectPolarityMonitor, formatViolations } = require('../../helpers/effectpolarity.js');
const {
    KNOWN_POLARITY_DEFECTS,
    POLARITY_ALLOWANCES,
    allowancesWithKnownDefects,
    seatAllowancesFor
} = require('../../helpers/polarityallowances.js');

const BASES = String(process.env.POLARITY_BASES || '91001').split(',').map(Number);
const ONLY = String(process.env.POLARITY_DECKS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FULL = process.env.POLARITY_FULL === '1';
const DECKS = ONLY.length > 0 ? ONLY : DECK_LABELS;

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

// One deck on one seat against one opponent, on one shuffle. Returns every
// wrong-side landing the monitor did not exempt.
async function playAndWatch(deckA, deckB, base) {
    const i = DECK_LABELS.indexOf(deckA);
    const j = DECK_LABELS.indexOf(deckB);
    const realRandom = Math.random;
    Math.random = shuffleRng(base + (i * 100 + j) * 97);
    let monitor = null;
    let controllers = [];
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
                monitor = new EffectPolarityMonitor(game, {
                    label: `${base}|${deckA}|${deckB}`,
                    controllers: controllers,
                    allowances: allowancesWithKnownDefects(),
                    seats: {
                        Seat0: { deck: deckA, allow: seatAllowancesFor(deckA) },
                        Seat1: { deck: deckB, allow: seatAllowancesFor(deckB) }
                    }
                });
            }
        });
    } finally {
        Math.random = realRandom;
    }
    monitor.detach();
    return {
        violations: monitor.violations,
        landings: monitor.landings,
        // An allowance excuses a card whose printed text hits both sides, or a
        // board that left no legal target on the right one. It must never
        // excuse a bot that HAD the right-side option and passed it over, so
        // the exempted landings are checked for that separately.
        avoidable: monitor.violations.concat(monitor.exempt).filter((entry) => entry.avoidable)
    };
}

describe('bot effect polarity (self-play field)', function() {
    let originalTimeout;

    beforeAll(function() {
        originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
        // A full game runs 1-3 seconds and a spec plays several of them.
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 15 * 60 * 1000;
    });

    afterAll(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    });

    const totals = { ready: 0, bow: 0, honor: 0, dishonor: 0 };

    DECKS.forEach(function(deck, index) {
        // Each deck answers for itself on BOTH seats: first player order changes
        // which prompts the deck ever sees, and several of these bugs only
        // surface on one of them.
        const opponents = FULL
            ? DECK_LABELS.filter((label) => label !== deck)
            : [DECK_LABELS[(index + 1) % DECK_LABELS.length]];

        it(`keeps ready/bow/honor/dishonor on the right side of the board: ${deck}`, async function() {
            const violations = [];
            const avoidable = [];
            for(const base of BASES) {
                for(const opponent of opponents) {
                    if(opponent === deck) {
                        continue;
                    }
                    for(const [a, b] of [[deck, opponent], [opponent, deck]]) {
                        const result = await playAndWatch(a, b, base);
                        for(const key of Object.keys(totals)) {
                            totals[key] += result.landings[key];
                        }
                        violations.push(...result.violations.filter((v) => v.deck === deck));
                        avoidable.push(...result.avoidable.filter((v) => v.deck === deck));
                    }
                }
            }
            // The hard gate: the bot passed over a legal correct-side target.
            // No allowance covers this, whatever card produced it.
            expect(avoidable.length).withContext(
                `${deck} aimed an effect at the wrong side while the right side was available:\n` +
                formatViolations(avoidable)
            ).toBe(0);
            expect(violations.length).withContext(
                `${deck} produced wrong-side effect landings:\n${formatViolations(violations)}`
            ).toBe(0);
        });
    });

    it('exercised enough of each effect for the invariant to mean something', function() {
        // A green suite that never saw a single honor is not evidence. These
        // floors are an order of magnitude below the observed counts for the
        // default one-base run.
        expect(totals.honor).toBeGreaterThan(20);
        expect(totals.dishonor).toBeGreaterThan(10);
        expect(totals.bow).toBeGreaterThan(10);
        expect(totals.ready).toBeGreaterThan(5);
    });

    it('lists the open polarity defects rather than hiding them', function() {
        // Not an assertion about the bot: a reminder that the allowance list
        // the specs run with is not all printed-text exceptions. Removing an
        // entry from KNOWN_POLARITY_DEFECTS is how a fix gets locked in, and
        // the list is empty today.
        const open = Object.entries(KNOWN_POLARITY_DEFECTS)
            .map(([id, rules]) => `${id} (${rules.join(', ')})`);
        if(open.length > 0) {
            console.log(`open bot polarity defects, see docs/bot-effect-polarity.md:\n  ${open.join('\n  ')}`);
        }
        for(const id of Object.keys(KNOWN_POLARITY_DEFECTS)) {
            expect(POLARITY_ALLOWANCES[id])
                .withContext(`${id} is listed as BOTH a printed-text exception and an open defect`)
                .toBeUndefined();
        }
    });
});
