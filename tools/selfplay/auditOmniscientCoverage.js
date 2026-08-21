'use strict';
// What is the omniscient seat actually BLIND to?
//
// Omniscience reads the opponent's hand off the live player object, so card
// BODIES (skill, cost, flat attachment bonuses) are exact for any deck. What a
// live card object cannot express is what an EVENT does — "initiate a duel",
// "discard a character" — and that comes from the curated `DeckAnalysis`
// registry. An event with no entry is priced at swing 0: the omniscient seat
// sees the card in hand and believes it is harmless.
//
// This walks every registered deck fixture and reports, per deck, which
// conflict-side events have no model. Those are the holes in the cheat.
//
// USAGE
//   node tools/selfplay/auditOmniscientCoverage.js
//   node tools/selfplay/auditOmniscientCoverage.js --json
process.env.LOG_LEVEL = 'error';
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { getCardModel } = require('../../build/server/game/bots/DeckAnalysis.js');

// A fixture entry is `{ count, card }` with the full EmeraldDB card payload
// embedded, so type/side come straight off the fixture and no card database
// lookup is needed.
function deckCards(deck) {
    const out = [];
    const push = (entry) => {
        const card = entry?.card || entry;
        if(card && card.id) {
            out.push(card);
        }
    };
    for(const key of ['conflictCards', 'dynastyCards', 'provinceCards', 'stronghold', 'role']) {
        const list = deck?.[key];
        if(Array.isArray(list)) {
            list.forEach(push);
        } else if(list) {
            push(list);
        }
    }
    return out;
}

const report = [];
for(const label of DECK_LABELS) {
    const deck = getDeckLoader(label)();
    const byId = new Map(deckCards(deck).map((card) => [String(card.id), card]));
    const ids = [...byId.keys()];
    const events = ids.filter((id) => {
        const data = byId.get(id);
        return data && data.type === 'event' && data.side === 'conflict';
    });
    const missing = events.filter((id) => !getCardModel(id));
    const modeled = events.filter((id) => {
        const model = getCardModel(id);
        return model && (model.swing > 0 || model.milBonus > 0 || model.polBonus > 0);
    });
    report.push({
        deck: label,
        cards: ids.length,
        conflictEvents: events.length,
        modeled: events.length - missing.length,
        priced: modeled.length,
        missing: missing
    });
}

if(process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
}

console.log('OMNISCIENT HAND-THREAT COVERAGE — conflict events per deck');
console.log('modeled = has a DeckAnalysis entry; priced = that entry carries a non-zero swing/bonus.');
console.log('An UNMODELED event is invisible to the cheat: it reads as 0 skill in the opponent hand.\n');
console.log(`${'deck'.padEnd(20)} ${'cards'.padStart(5)} ${'events'.padStart(6)} ` +
    `${'modeled'.padStart(7)} ${'priced'.padStart(6)}  unmodeled ids`);
for(const row of report) {
    const flag = row.missing.length > 0 ? ' <-- BLIND' : '';
    console.log(`${row.deck.padEnd(20)} ${String(row.cards).padStart(5)} ` +
        `${String(row.conflictEvents).padStart(6)} ${String(row.modeled).padStart(7)} ` +
        `${String(row.priced).padStart(6)}  ${row.missing.join(', ')}${flag}`);
}
const allMissing = [...new Set(report.flatMap((row) => row.missing))].sort();
console.log(`\n${allMissing.length} distinct unmodeled conflict event(s) across the field:`);
console.log(allMissing.join('\n'));
