'use strict';
// CENSUS of City of the Rich Frog: what the province produces, and what the
// end-phase rule decides about it.
//
//   SUBJECT=DragonAttachments GAMES=2 node tools/selfplay/analyzeRichFrog.js
//   SUBJECT=Lion ARM='{"deckProfile":{"mulligan":{"refillProvinceIds":[]}}}' \
//     node tools/selfplay/analyzeRichFrog.js
//
// The province refills to THREE cards, but `Player.replaceDynastyCard` refuses
// to refill while ANY dynasty card is still on it (`getSourceList(location)
// .size() > 1`, and that list carries the province card itself). So it is
// all-or-nothing: leave one card behind and the province is capped at that one
// card for the rest of the game. `MulliganProfile.refillProvinceIds` makes the
// end-phase decision per PROVINCE instead of per card.
//
// A win rate cannot say whether that rule made the province produce more, so
// this reports the two things that can:
//   * PLAYS    -- dynasty cards bought, by province id. The Rich Frog share is
//                 the number the change is supposed to move.
//   * DECISION -- how often the end-phase rule kept vs emptied it, and how many
//                 priority characters were sitting there when it did.
//
// `BotTelemetry` is a global static sink shared by BOTH controllers in a game,
// and SIX decks in the field hold City of the Rich Frog -- so every event kind
// carries a `player` field and this script filters on it. Without that, a
// pairing of two Rich Frog decks reports both bots' rows under the subject.
//
//   SUBJECT=<label>   deck under test (default DragonAttachments)
//   GAMES=<n>         games per opponent per seat (default 2)
//   BASE=<n>          shuffle base (default 91001)
//   ONLY=<csv>        restrict the opponent field
//   ARM=<json>        v2Profile patch applied to the SUBJECT seat only
//   PROVINCE=<id>     province to census (default city-of-the-rich-frog)
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { BotTelemetry } = require('../../build/server/game/bots/BotTelemetry.js');

const SUBJECT = process.env.SUBJECT || 'DragonAttachments';
const BASE = Number(process.env.BASE || 91001);
const GAMES = Number(process.env.GAMES || 2);
const ONLY = String(process.env.ONLY || '');
const ARM = String(process.env.ARM || '');
const PROVINCE = process.env.PROVINCE || 'city-of-the-rich-frog';
const OPPONENTS = (ONLY ? ONLY.split(',') : DECK_LABELS).filter((label) => label !== SUBJECT);

if(!DECK_LABELS.includes(SUBJECT)) {
    console.error(`Unknown subject deck ${SUBJECT}. Known: ${DECK_LABELS.join(', ')}`);
    process.exit(1);
}

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

(async () => {
    const arm = ARM ? JSON.parse(ARM) : undefined;
    const playsByProvince = new Map();
    const frogCardCounts = new Map();
    const priorityHistogram = new Map();
    const stockHistogram = new Map();
    let games = 0;
    let stockSamples = 0;
    let stockCards = 0;
    let brokenSamples = 0;
    let totalPlays = 0;
    let frogPlays = 0;
    let frogCharacterPlays = 0;
    let gamesWithFrogPlay = 0;
    let keepDecisions = 0;
    let wipeDecisions = 0;

    for(const opponent of OPPONENTS) {
        for(let g = 0; g < GAMES; g++) {
            for(const subjectSeat of [0, 1]) {
                const shuffle = BASE + g * 7919 + OPPONENTS.indexOf(opponent) * 97;
                const seatName = `Seat${subjectSeat}`;
                const events = [];
                BotTelemetry.attach((event) => {
                    if(event.kind !== 'province-play' && event.kind !== 'refill-province-plan' &&
                        event.kind !== 'province-stock') {
                        return;
                    }
                    if(event.player && event.player !== seatName) {
                        return;
                    }
                    events.push(event);
                });
                Math.random = rng(shuffle);
                await runGame({
                    names: ['Seat0', 'Seat1'],
                    seeds: [1, 1],
                    deckA: subjectSeat === 0 ? getDeckLoader(SUBJECT)() : getDeckLoader(opponent)(),
                    deckB: subjectSeat === 0 ? getDeckLoader(opponent)() : getDeckLoader(SUBJECT)(),
                    // The arm rides the standard injection path, which needs the
                    // pass-through V2 engine on both seats so the control seat
                    // opposite it stays bit-identical to a V1 control.
                    engineVersions: arm ? ['v2', 'v2'] : ['v1', 'v1'],
                    v2Modes: arm ? ['pass-through', 'pass-through'] : undefined,
                    v2Profiles: arm
                        ? [subjectSeat === 0 ? arm : undefined, subjectSeat === 1 ? arm : undefined]
                        : undefined
                });
                BotTelemetry.detach();
                games++;

                let sawFrogPlay = false;
                for(const event of events) {
                    if(event.kind === 'province-play') {
                        const id = String(event.provinceId || 'unknown');
                        playsByProvince.set(id, (playsByProvince.get(id) || 0) + 1);
                        totalPlays++;
                        if(id === PROVINCE) {
                            frogPlays++;
                            sawFrogPlay = true;
                            if(event.cardType === 'character') {
                                frogCharacterPlays++;
                            }
                            const card = String(event.cardId || '');
                            frogCardCounts.set(card, (frogCardCounts.get(card) || 0) + 1);
                        }
                        continue;
                    }
                    if(event.provinceId !== PROVINCE) {
                        continue;
                    }
                    if(event.kind === 'province-stock') {
                        // A BROKEN province is blank (`ProvinceCard.isBlank`),
                        // so it has lost its own refillProvinceTo effect and is
                        // a one-card province for the rest of the game. Those
                        // rounds are not the rule's to win or lose; counting
                        // them drags the mean toward 1 whatever the rule does.
                        if(event.broken) {
                            brokenSamples++;
                            continue;
                        }
                        const n = Number(event.cards) || 0;
                        stockHistogram.set(n, (stockHistogram.get(n) || 0) + 1);
                        stockSamples++;
                        stockCards += n;
                        continue;
                    }
                    if(event.keep) {
                        keepDecisions++;
                    } else {
                        wipeDecisions++;
                    }
                    const n = Number(event.priorityCount) || 0;
                    priorityHistogram.set(n, (priorityHistogram.get(n) || 0) + 1);
                }
                if(sawFrogPlay) {
                    gamesWithFrogPlay++;
                }
            }
        }
    }

    const pct = (n, d) => (d > 0 ? `${(100 * n / d).toFixed(2)}%` : 'n/a');
    console.log(`subject=${SUBJECT} games=${games} base=${BASE} arm=${ARM || '(shipped)'}`);
    console.log('');
    console.log('PLAYS from provinces');
    for(const [id, count] of [...playsByProvince].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(5)}  ${pct(count, totalPlays).padStart(7)}  ${id}`);
    }
    console.log(`  total ${totalPlays}`);
    console.log('');
    console.log(PROVINCE);
    console.log(`  plays              ${frogPlays} (${pct(frogPlays, totalPlays)} of all province plays)`);
    console.log(`  characters         ${frogCharacterPlays}`);
    console.log(`  plays per game     ${(frogPlays / Math.max(1, games)).toFixed(2)}`);
    console.log(`  games with a play  ${gamesWithFrogPlay} / ${games} (${pct(gamesWithFrogPlay, games)})`);
    console.log('');
    console.log('END-PHASE DECISION');
    const decisions = keepDecisions + wipeDecisions;
    console.log(`  keep  ${keepDecisions} (${pct(keepDecisions, decisions)})`);
    console.log(`  wipe  ${wipeDecisions} (${pct(wipeDecisions, decisions)})`);
    console.log(`  priority characters present: ${[...priorityHistogram]
        .sort((a, b) => a[0] - b[0])
        .map(([n, count]) => `${n}=${count}`)
        .join(' ') || '(none)'}`);
    console.log('');
    console.log('CARDS ON IT WHEN THE DYNASTY PHASE OPENS  (prints 3)');
    console.log(`  mean ${(stockCards / Math.max(1, stockSamples)).toFixed(2)} over ${stockSamples} unbroken dynasty phases ` +
        `(${brokenSamples} broken, excluded)`);
    console.log(`  ${[...stockHistogram]
        .sort((a, b) => a[0] - b[0])
        .map(([n, count]) => `${n}=${count}`)
        .join(' ') || '(none)'}`);
    console.log('');
    console.log('CARDS BOUGHT OFF IT');
    for(const [id, count] of [...frogCardCounts].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.log(`  ${String(count).padStart(5)}  ${id}`);
    }
})().catch((e) => {
    process.stderr.write(String((e && e.stack) || e) + '\n');
    process.exit(1);
});
