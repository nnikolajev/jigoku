'use strict';
// POPULATION of the Formal Invitation two-step.
//
//   SUBJECT=LionDuelist GAMES=2 BASE=91001 node tools/selfplay/analyzeFormalInvitation.js
//
// Formal Invitation is an attachment whose ONLY payoff is a board Action:
// during a political conflict, move the attached character into it. The bot is
// told to hang it on a body at HOME (`AttachmentTargetPolicy.HOME_BEARER_
// ATTACHMENT_IDS`), because a participating bearer makes the Action dead. That
// makes it a two-step: attach now, move later. A live game showed the bot doing
// the first leg and then PASSING, which is the same shape as the ready -> move
// sequencer defects.
//
// A two-step can break in four independent places, so all four are counted
// separately:
//
//   BEARER   the attachment reached a body at all.
//   WINDOW   a POLITICAL conflict ran while an idle (unbowed, non-participating)
//            bearer stood at home — the Action's condition was satisfied and the
//            body was there to move.
//   FIRE     the engine actually resolved a `moveToConflict` sourced from
//            Formal Invitation.
//   STRANDED a window closed with the Action unused.
//
// A bearer that never sees a political conflict is not a defect; a bearer that
// sees one and stays home is.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { CardTypes, EventNames } = require('../../build/server/game/Constants.js');
const { moveSourceSpec } = require('../../build/server/game/bots/ReadyMovePlanner.js');

const CARD_ID = String(process.env.CARD || 'formal-invitation');
const SUBJECT = process.env.SUBJECT || 'LionDuelist';
const BASE = Number(process.env.BASE || 91001);
const GAMES = Number(process.env.GAMES || 2);
const ONLY = String(process.env.ONLY || '');
const OPPONENTS = (ONLY ? ONLY.split(',') : DECK_LABELS).filter((label) => label !== SUBJECT);
// The axis the card itself is restricted to, from the bot's own move-source
// table. Undefined means the card works on either axis, and a ban on one of
// them is then not a wasted placement.
const AXIS = moveSourceSpec(CARD_ID)?.conflictType;

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

// An idle bearer: our character, wearing the card, unbowed, and NOT already in
// the conflict. Those are exactly the bodies the Action exists to move.
function idleBearers(player) {
    const cards = player.cardsInPlay ? player.cardsInPlay.toArray() : [];
    // `cardsInPlay` is an underscore wrapper; `attachments` is a plain array.
    return cards.filter((card) =>
        card.getType() === CardTypes.Character &&
        !card.bowed &&
        !card.isParticipating() &&
        (card.attachments || []).some((attachment) => attachment.id === CARD_ID));
}

// Attach one game and return the counters it produced.
function watch(game, seatName) {
    const stats = {
        attached: 0, windows: 0, fires: 0, stranded: 0,
        blockedBearer: 0, attachNeverFired: 0,
        strandedDetail: [], blockedDetail: []
    };
    // Attaches made during a conflict, cleared when that conflict ends: an
    // attach whose Action never fires in the conflict it was played in is the
    // two-step breaking in half.
    let pendingAttaches = 0;
    let open = null;

    // The attachment is PLAYED in a conflict action window, so the bearer is
    // not wearing it yet when the conflict starts. Sampling only at the start
    // would score the card's own conflict as "no window" and miss exactly the
    // two-step this script exists to measure — so the window is (re)opened at
    // every point the state could newly satisfy the Action's condition.
    const openWindow = () => {
        const conflict = game.currentConflict;
        const player = game.getPlayers().find((p) => p.name === seatName);
        if(!conflict || !player || (AXIS && conflict.conflictType !== AXIS)) {
            return;
        }
        const bearers = idleBearers(player);
        if(bearers.length === 0) {
            return;
        }
        if(open) {
            open.names = bearers.map((card) => card.name);
            return;
        }
        open = {
            fired: false,
            round: game.roundNumber,
            attacking: conflict.attackingPlayer === player,
            names: bearers.map((card) => card.name)
        };
        stats.windows++;
    };

    game.on(EventNames.OnCardAttached, (event) => {
        if(event?.card?.id !== CARD_ID || event?.card?.controller?.name !== seatName) {
            return;
        }
        stats.attached++;
        // The defect class: the card's whole payoff is moving this bearer into
        // a political conflict, and the ENGINE forbids this bearer from joining
        // one at all (Stolen Breath, Pacifism, a printed dash). Asked of the
        // engine, so no card-id list can go stale.
        const bearer = event.card.parent;
        if(AXIS && bearer && !bearer.canParticipateAsAttacker(AXIS) &&
            !bearer.canParticipateAsDefender(AXIS)) {
            stats.blockedBearer++;
            stats.blockedDetail.push(`r${game.roundNumber} ${bearer.name}`);
        }
        // Only a POLITICAL conflict counts: the Action's own condition is
        // `isDuringConflict('political')`, so an attach made during a military
        // conflict was never going to fire in it and is not a broken two-step.
        if(game.currentConflict && (!AXIS || game.currentConflict.conflictType === AXIS)) {
            pendingAttaches++;
        }
        openWindow();
    });
    game.on(EventNames.OnMoveToConflict, (event) => {
        if(event?.context?.source?.id === CARD_ID) {
            stats.fires++;
            pendingAttaches = Math.max(0, pendingAttaches - 1);
            if(open) {
                open.fired = true;
            }
        }
    });
    game.on(EventNames.OnConflictStarted, () => openWindow());
    game.on(EventNames.OnDefendersDeclared, () => openWindow());
    game.on(EventNames.OnConflictFinished, () => {
        stats.attachNeverFired += pendingAttaches;
        pendingAttaches = 0;
        if(open && !open.fired) {
            stats.stranded++;
            stats.strandedDetail.push(
                `r${open.round} ${open.attacking ? 'attacking' : 'defending'} ` +
                `bearer=${open.names.join('/')}`);
        }
        open = null;
    });
    return stats;
}

(async () => {
    let games = 0;
    let gamesWithBearer = 0;
    let gamesWithWindow = 0;
    let gamesWithFire = 0;
    const totals = { attached: 0, windows: 0, fires: 0, stranded: 0, blockedBearer: 0, attachNeverFired: 0 };
    const perDeck = new Map();
    const samples = [];

    for(const opponent of OPPONENTS) {
        for(let g = 0; g < GAMES; g++) {
            for(const subjectSeat of [0, 1]) {
                const shuffle = BASE + g * 7919 + OPPONENTS.indexOf(opponent) * 97;
                const seatName = `Seat${subjectSeat}`;
                let stats = null;
                Math.random = rng(shuffle);
                const result = await runGame({
                    names: ['Seat0', 'Seat1'],
                    seeds: [1, 1],
                    deckA: subjectSeat === 0 ? getDeckLoader(SUBJECT)() : getDeckLoader(opponent)(),
                    deckB: subjectSeat === 0 ? getDeckLoader(opponent)() : getDeckLoader(SUBJECT)(),
                    engineVersions: ['v1', 'v1'],
                    onGame: (game) => {
                        stats = watch(game, seatName);
                    }
                });
                games++;
                if(!stats) {
                    continue;
                }
                totals.attached += stats.attached;
                totals.windows += stats.windows;
                totals.fires += stats.fires;
                totals.stranded += stats.stranded;
                totals.blockedBearer += stats.blockedBearer;
                totals.attachNeverFired += stats.attachNeverFired;
                gamesWithBearer += stats.attached > 0 ? 1 : 0;
                gamesWithWindow += stats.windows > 0 ? 1 : 0;
                gamesWithFire += stats.fires > 0 ? 1 : 0;

                const row = perDeck.get(opponent) ||
                    { games: 0, attached: 0, windows: 0, fires: 0, stranded: 0 };
                row.games++;
                row.attached += stats.attached;
                row.windows += stats.windows;
                row.fires += stats.fires;
                row.stranded += stats.stranded;
                perDeck.set(opponent, row);

                if(stats.blockedBearer > 0) {
                    console.log(`  !! BLOCKED BEARER ${shuffle}|${SUBJECT}|${opponent} seat${subjectSeat}: ` +
                        stats.blockedDetail.join(' ; '));
                }
                if(stats.stranded > 0 && samples.length < 12) {
                    samples.push(`${shuffle}|${SUBJECT}|${opponent} seat${subjectSeat}: ` +
                        stats.strandedDetail.slice(0, 3).join(' ; '));
                }
                process.stdout.write(
                    `${opponent} g${g} seat${subjectSeat} attached=${stats.attached} ` +
                    `windows=${stats.windows} fired=${stats.fires} stranded=${stats.stranded} ` +
                    `(${result.winner === seatName ? 'W' : 'L'})\n`);
            }
        }
    }

    const pct = (n, d) => `${(100 * n / Math.max(1, d)).toFixed(1)}%`;
    console.log(`\nCARD=${CARD_ID} SUBJECT=${SUBJECT} base=${BASE} games=${games}`);
    console.log(`  attached to a body     ${totals.attached} times, in ${gamesWithBearer} games (${pct(gamesWithBearer, games)})`);
    console.log(`  ${AXIS || 'any'} conflict with an IDLE bearer at home: ${totals.windows} windows, ${gamesWithWindow} games (${pct(gamesWithWindow, games)})`);
    console.log(`  Action RESOLVED        ${totals.fires} times, in ${gamesWithFire} games (${pct(gamesWithFire, games)})`);
    console.log(`  window closed UNUSED   ${totals.stranded} (${pct(totals.stranded, totals.windows)} of windows)`);
    console.log(`  attached to a bearer the RULES bar from a ${AXIS || '(no axis)'} conflict: ` +
        `${totals.blockedBearer}${AXIS ? ' (must be 0)' : ' (n/a: card has no axis)'}`);
    console.log(`  attached during a ${(AXIS || 'any').toUpperCase()} conflict, Action never fired in it: ${totals.attachNeverFired}`);

    console.log('\nper opponent (attached / windows / fired / stranded over games):');
    for(const [deck, row] of [...perDeck.entries()].sort()) {
        console.log(`  ${deck.padEnd(20)} ${row.attached} / ${row.windows} / ${row.fires} / ${row.stranded}  (${row.games} games)`);
    }
    if(samples.length > 0) {
        console.log('\nstranded samples:');
        for(const line of samples) {
            console.log(`  ${line}`);
        }
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
