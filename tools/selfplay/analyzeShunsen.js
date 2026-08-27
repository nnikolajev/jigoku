'use strict';
// POPULATION of Agasha Shunsen's Action.
//
//   GAMES=4 BASE=91001 node tools/selfplay/analyzeShunsen.js
//
// His Action is `condition: () => game.isDuringConflict()` and the bot gates it
// on top of that. A gate this narrow has to be CENSUSED, not reasoned about: if
// the card is dead in live play, the reason it is dead is the leg that refuses
// most often, and a boolean cannot say which one that was.
//
// Reports three separate things, because they fail independently:
//   * BODY     — did Shunsen reach the board at all?
//   * WINDOW   — did the bot ever evaluate his Action gate, and what refused?
//   * RESOLVE  — did the Action actually resolve, per the engine's own message
//                log (the effect line is "search their deck for an attachment")?
//
// A lever that never fires cannot be measured, and tuning its values cannot
// help. See `.claude/skills/roundrobin/SKILL.md`.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { BotTelemetry } = require('../../build/server/game/bots/BotTelemetry.js');

const SUBJECT = process.env.SUBJECT || 'DragonAttachments';
const BASE = Number(process.env.BASE || 91001);
const GAMES = Number(process.env.GAMES || 2);
const ONLY = String(process.env.ONLY || '');
const OPPONENTS = (ONLY ? ONLY.split(',') : DECK_LABELS).filter((label) => label !== SUBJECT);

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Message arguments are the engine's own summary objects, plain strings, or
// nested arrays of either. Named accessors first, then the string coercion the
// engine itself uses in `addMessage`.
const flatten = (entry) => {
    if(entry === null || entry === undefined) {
        return '';
    }
    if(Array.isArray(entry)) {
        return entry.map(flatten).join(' ');
    }
    const named = entry.name ?? entry.message ?? entry.id;
    return named === undefined ? String(entry) : String(named);
};

// The engine's formatted messages are argument arrays, so flattening leaves
// runs of whitespace between the pieces. Collapse them or every multi-word
// regex below silently fails to match.
const messageText = (message) =>
    [flatten(message?.message), flatten(message?.arguments)].join(' ')
        .replace(/\s+/g, ' ');

(async () => {
    const tally = new Map();
    let games = 0;
    let gamesWithBody = 0;
    let gamesWithWindow = 0;
    let gamesWithResolve = 0;
    let resolves = 0;
    let wastes = 0;
    const perDeck = new Map();

    for(const opponent of OPPONENTS) {
        for(let g = 0; g < GAMES; g++) {
            for(const subjectSeat of [0, 1]) {
                const shuffle = BASE + g * 7919 + OPPONENTS.indexOf(opponent) * 97;
                const seatName = `Seat${subjectSeat}`;
                const events = [];
                BotTelemetry.attach((event) => {
                    if(event.kind === 'shunsen-action-gate' ||
                        event.kind === 'shunsen-declare-window') {
                        events.push(event);
                    }
                });
                Math.random = rng(shuffle);
                const result = await runGame({
                    names: ['Seat0', 'Seat1'],
                    seeds: [1, 1],
                    deckA: subjectSeat === 0 ? getDeckLoader(SUBJECT)() : getDeckLoader(opponent)(),
                    deckB: subjectSeat === 0 ? getDeckLoader(opponent)() : getDeckLoader(SUBJECT)(),
                    engineVersions: ['v1', 'v1'],
                    // The harness builds its OWN record from this and returns
                    // it; the object passed in is never written back.
                    record: { viewer: seatName }
                });
                BotTelemetry.detach();
                games++;

                const messages = result.record?.messages || [];
                const text = messages.map(messageText);
                // The body reached the board: the engine announces every play.
                const body = text.some((line) =>
                    /Agasha Shunsen/i.test(line) && /plays|puts into play/i.test(line));
                // The Action resolved: its own effect line.
                const resolved = text.filter((line) =>
                    /uses Agasha Shunsen/i.test(line) &&
                    /search their deck for an attachment/i.test(line)).length;
                // WASTE, attributed: the engine discards an over-cap
                // Restricted attachment on arrival, but every attachment play
                // can trigger that line. Only a discard that follows a Shunsen
                // use within a couple of messages is HIS waste.
                const wasted = text.reduce((count, line, index) => {
                    if(!/due to too many Restricted attachments/i.test(line)) {
                        return count;
                    }
                    const window = text.slice(Math.max(0, index - 3), index);
                    return window.some((earlier) => /uses Agasha Shunsen/i.test(earlier))
                        ? count + 1
                        : count;
                }, 0);

                if(body) {
                    gamesWithBody++;
                }
                if(events.length > 0) {
                    gamesWithWindow++;
                }
                if(resolved > 0) {
                    gamesWithResolve++;
                    resolves += resolved;
                }
                wastes += wasted;
                const row = perDeck.get(opponent) ||
                    { games: 0, body: 0, window: 0, resolved: 0 };
                row.games++;
                row.body += body ? 1 : 0;
                row.window += events.length > 0 ? 1 : 0;
                row.resolved += resolved > 0 ? 1 : 0;
                perDeck.set(opponent, row);

                for(const event of events) {
                    if(event.kind !== 'shunsen-action-gate') {
                        continue;
                    }
                    const key = String(event.gate);
                    tally.set(key, (tally.get(key) || 0) + 1);
                }
                process.stdout.write(
                    `${opponent} g${g} seat${subjectSeat} ` +
                    `body=${body ? 1 : 0} windows=${events.length} resolved=${resolved} ` +
                    `wasted=${wasted} ` +
                    `(${result.winner === seatName ? 'W' : 'L'})\n`);
            }
        }
    }

    const pct = (n, d) => `${(100 * n / Math.max(1, d)).toFixed(1)}%`;
    console.log(`\nSUBJECT=${SUBJECT} base=${BASE} games=${games}`);
    console.log(`  Shunsen reached the board in ${gamesWithBody} games (${pct(gamesWithBody, games)})`);
    console.log(`  Action gate evaluated in     ${gamesWithWindow} games (${pct(gamesWithWindow, games)})`);
    console.log(`  Action RESOLVED in           ${gamesWithResolve} games (${pct(gamesWithResolve, games)}), ${resolves} times total`);
    console.log(`  Shunsen's tutored card discarded for the Restricted cap: ${wastes}`);

    const total = [...tally.values()].reduce((sum, n) => sum + n, 0);
    console.log(`\ngate verdicts over ${total} evaluations:`);
    for(const [reason, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${reason.padEnd(30)} ${String(n).padStart(6)} (${pct(n, total)})`);
    }

    console.log('\nper opponent (games with a resolve / games with a body / games):');
    for(const [deck, row] of [...perDeck.entries()].sort()) {
        console.log(`  ${deck.padEnd(18)} ${row.resolved} / ${row.body} / ${row.games}`);
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
