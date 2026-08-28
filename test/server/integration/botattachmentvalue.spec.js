'use strict';

// GENERIC BOT ATTACHMENT-VALUE INVARIANT, measured in real games.
//
// Sibling of `botreadyvalue.spec.js`. Every deck plays complete headless
// self-play games and an AttachmentValueMonitor watches the engine's own
// `onCardAttached` events. One invariant, whatever the card and whatever the
// deck overlay:
//
//   an attachment with a printed skill line, played INTO a live conflict,
//   never lands on a body that contributes nothing to it while the same prompt
//   was offering an unbowed participant.
//
// That is the hard gate, and it is deliberately narrow so the assertion is
// about the bot and not about the opponent's later choices: the alternatives
// come from the prompt's own selectable list, which already applies every
// attachment restriction the engine knows ("no attachments except Weapon",
// faction and trait restrictions, the restricted cap). A placement the engine
// never offered a choice on can never fail here — it is counted as `forced`
// and printed instead.
//
// Everything softer is counted and printed, never failed:
//   * `prep`      — placed with no conflict running. An attachment is
//                   permanent, so building a tower before it commits is the
//                   intended play, not a mistake.
//   * `used-later`— a `prep` placement whose bearer later fought carrying it.
//   * `readied-in`— landed on a bowed participant that was standing by
//                   resolution: the ready -> skill sequence working.
//   * `forced`    — idle, but the prompt offered no participating alternative.
//   * `out-of-reach` — idle with an alternative, in a conflict short by more
//                   skill than `AttachmentTargetConfig.maxSkillNeeded`. The
//                   shipped policy banks the card on the durable body there by
//                   design, so the monitor reads the cap off the policy rather
//                   than second-guessing it.
//
// Scaling knobs (default is one game per deck per seat, ~1 minute):
//   ATTACH_BASES=91001,92001   shuffle bases to play
//   ATTACH_DECKS=Crane,Lion    restrict to these decks
//   ATTACH_FULL=1              every ordered cross-deck pairing (slow)
//   ATTACH_PROFILE='{"deckProfile":{"attachmentTarget":{"enabled":true}}}'
//                              inject a profile arm into BOTH seats, so the
//                              suite can be run against a lever that has not
//                              been made the default yet

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('../../../tools/selfplay/harness.js');
const { DECK_LABELS, getDeckLoader } = require('../../../tools/selfplay/deckRegistry.js');
const {
    AttachmentValueMonitor, formatPlacements, groupByAttachment
} = require('../../helpers/attachmentvalue.js');
const { KNOWN_ATTACHMENT_DEFECTS, attachmentDefectIds } = require('../../helpers/attachmentallowances.js');

const BASES = String(process.env.ATTACH_BASES || '91001').split(',').map(Number);
const ONLY = String(process.env.ATTACH_DECKS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FULL = process.env.ATTACH_FULL === '1';
const DECKS = ONLY.length > 0 ? ONLY : DECK_LABELS;
const PROFILE = process.env.ATTACH_PROFILE ? JSON.parse(process.env.ATTACH_PROFILE) : undefined;

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
    let controllers = [];
    try {
        await runGame({
            names: ['Seat0', 'Seat1'],
            seeds: [1, 1],
            deckA: getDeckLoader(deckA)(),
            deckB: getDeckLoader(deckB)(),
            v2Profiles: [PROFILE, PROFILE],
            onControllers: (created) => {
                controllers = created;
            },
            onGame: (game) => {
                monitor = new AttachmentValueMonitor(game, {
                    label: `${base}|${deckA}|${deckB}`,
                    controllers,
                    seats: { Seat0: { deck: deckA }, Seat1: { deck: deckB } }
                });
            }
        });
    } finally {
        Math.random = realRandom;
    }
    monitor.detach();
    const open = new Set(attachmentDefectIds());
    return {
        counts: monitor.counts,
        wasted: monitor.wasted.filter((entry) => !open.has(entry.sourceId)),
        knownOpen: monitor.wasted.filter((entry) => open.has(entry.sourceId)).length,
        blockedBearers: monitor.blockedBearers,
        idle: monitor.idle,
        placements: monitor.placements
    };
}

describe('bot attachment value (self-play field)', function() {
    let originalTimeout;

    beforeAll(function() {
        originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 15 * 60 * 1000;
    });

    afterAll(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    });

    const totals = {
        total: 0, contributed: 0, abilityCarrier: 0, prep: 0, usedLater: 0,
        readiedIn: 0, idle: 0, wasted: 0, forced: 0, outOfReach: 0,
        outsideConflict: 0, moveInBearer: 0, blockedBearer: 0
    };
    let knownOpenSeen = 0;
    const allIdle = [];
    const allWasted = [];
    const allBlockedBearers = [];

    DECKS.forEach(function(deck, index) {
        // Both seats: first-player order decides which conflicts a deck ever
        // gets to declare, and the whole question is about the conflict an
        // attachment was played into.
        const opponents = FULL
            ? DECK_LABELS.filter((label) => label !== deck)
            : [DECK_LABELS[(index + 1) % DECK_LABELS.length]];

        it(`never hangs a skill attachment on a body that cannot use it: ${deck}`, async function() {
            const wasted = [];
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
                        knownOpenSeen += result.knownOpen;
                        wasted.push(...result.wasted.filter((entry) => entry.deck === deck));
                        allWasted.push(...result.wasted);
                        allBlockedBearers.push(...result.blockedBearers);
                        allIdle.push(...result.idle);
                    }
                }
            }
            expect(wasted.length).withContext(
                `${deck} attached a skill bonus to a body that contributed nothing, ` +
                `while the same prompt offered a participating alternative:\n${formatPlacements(wasted)}`
            ).toBe(0);
        });
    });

    it('exercised enough attachments for the invariant to mean something', function() {
        expect(totals.total).toBeGreaterThan(10);
    });

    it('fails on an avoidable placement by EITHER seat, not only the deck under test', function() {
        // The per-deck gates above filter to their own deck, and a deck only
        // plays its own pairings, so a defect made by the opposing seat would
        // otherwise be counted in the totals and asserted by nobody. Same
        // backstop `botreadyvalue.spec.js` runs for wasted moves.
        expect(allWasted.length).withContext(
            `attachments hung on a body that could not use them:
${formatPlacements(allWasted)}`
        ).toBe(0);
    });

    // The move-in cards (Formal Invitation, Spyglass) are exempted from the
    // participant preference precisely BECAUSE their Action moves the bearer
    // in. That exemption is only sound while the bearer can actually join the
    // conflict the card works in: a body under Stolen Breath or Pacifism is at
    // home, unbowed, and permanently unable to use the card, and the engine
    // then refuses the Action. Live defect, 2026-08-28.
    it('never hands a move-in attachment to a bearer the rules bar from that conflict type', function() {
        expect(allBlockedBearers.length).withContext(
            `move-in attachments placed on a bearer that can never join a conflict of ` +
            `the type the card works in:
${formatPlacements(allBlockedBearers)}`
        ).toBe(0);
    });

    it('reports the idle placements rather than hiding them', function() {
        console.log(
            `attachment value: ${totals.total} own-side attachments — ` +
            `${totals.contributed} counted in the conflict they were played into, ` +
            `${totals.readiedIn} on a bowed participant that stood up, ` +
            `${totals.moveInBearer} on a home bearer their own Action moves in ` +
            `(${totals.blockedBearer} of them on a bearer the rules bar from that conflict type), ` +
            `${totals.abilityCarrier} ability carriers, ` +
            `${totals.outsideConflict} placed outside a conflict ` +
            `(${totals.usedLater} later fought carrying it, ${totals.prep} never did), ` +
            `${totals.idle} idle (${totals.forced} of them forced, ` +
            `${totals.outOfReach} past the reach cap, ${totals.wasted} avoidable).`
        );
        if(allIdle.length > 0) {
            console.log('idle placements by card (not all failures):');
            for(const row of groupByAttachment(allIdle)) {
                console.log(`  ${String(row.count).padStart(4)}  ${row.attachment} [${row.attachmentId}] ` +
                    `${row.avoidable} avoidable, decks: ${[...row.decks].join(', ')}` +
                    `${row.reasons.size > 0 ? `, reasons: ${[...row.reasons].join(', ')}` : ''}`);
            }
            console.log(formatPlacements(allIdle, 30));
        }
        expect(totals.total).toBeGreaterThan(0);
    });

    it('lists the open attachment defects rather than hiding them', function() {
        const open = Object.entries(KNOWN_ATTACHMENT_DEFECTS).map(([id, why]) => `${id}: ${why}`);
        console.log(`open attachment defects (${knownOpenSeen} landings this run):`);
        for(const line of open) {
            console.log(`  ${line}`);
        }
        // The list exists to be emptied, not grown.
        expect(open.length).toBeLessThanOrEqual(6);
    });
});
