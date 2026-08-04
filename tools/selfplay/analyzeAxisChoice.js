'use strict';
// Reads a probePaired.js dump of `axis-choice` events and answers, for the
// opponent-aware conflict axis:
//
//   1. is the decision even reached, and how often?
//   2. at what weight does it start choosing a DIFFERENT axis than V1?
//   3. which decks does it move, and which short-circuit before it?
//
// The third question is the one deck tuning turns on: a deck whose axis is
// already owned by its own rules (the rush profile forces military; a dishonor
// deck steers by ring) should show zero divergence, and if it does not, the
// wiring is reaching past a rule that was supposed to win.
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const events = data.events.filter((e) => e.kind === 'axis-choice');
const num = (v) => Number(v) || 0;

// Replay the policy's comparison offline at other weights. The zero-skill
// guards come first at every weight, so a window they resolve can never
// diverge however the weight is set.
const wouldDiverge = (e, weight) => {
    if(e.forceMilitary && num(e.myMilitary) > 0) {
        return false;
    }
    if(num(e.myMilitary) <= 0 || num(e.myPolitical) <= 0) {
        return false;
    }
    const baseline = num(e.myMilitary) >= num(e.myPolitical) ? 'military' : 'political';
    const mil = num(e.myMilitary) - weight * num(e.theirMilitary);
    const pol = num(e.myPolitical) - weight * num(e.theirPolitical);
    return (mil >= pol ? 'military' : 'political') !== baseline;
};

for(const arm of ['control', 'treated']) {
    const own = events.filter((e) => e.arm === arm && e.seat === 'Seat0');
    if(own.length === 0) {
        continue;
    }
    console.log(`${arm} seat0: ${own.length} axis decisions`);
    const byReason = new Map();
    for(const e of own) {
        byReason.set(e.reason, (byReason.get(e.reason) || 0) + 1);
    }
    for(const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(reason).padEnd(16)} ${String(n).padStart(5)}  ${(100 * n / own.length).toFixed(1)}%`);
    }
    console.log(`    actually divergent from V1: ${own.filter((e) => e.divergent).length}`);
    console.log('    if the weight were:');
    for(const weight of [0.25, 0.5, 0.75, 1, 1.5]) {
        const n = own.filter((e) => wouldDiverge(e, weight)).length;
        console.log(`      ${String(weight).padEnd(5)} -> ${String(n).padStart(5)} divergent (${(100 * n / own.length).toFixed(1)}%)`);
    }
    console.log('');
}

// Per deck: how much of the deck's declaration this would move, and whether a
// deck rule already claims it first.
const treated = events.filter((e) => e.arm === 'treated' && e.seat === 'Seat0');
if(treated.length) {
    console.log('per deck (treated seat pilots deckA)');
    console.log(`  ${'deck'.padEnd(20)} decisions  force-mil  only-axis  divergent  @w=1`);
    const decks = [...new Set(treated.map((e) => e.deckA))].sort();
    for(const deck of decks) {
        const own = treated.filter((e) => e.deckA === deck);
        const forced = own.filter((e) => e.reason === 'force-military').length;
        const only = own.filter((e) => e.reason === 'only-military' || e.reason === 'only-political').length;
        const div = own.filter((e) => e.divergent).length;
        const atOne = own.filter((e) => wouldDiverge(e, 1)).length;
        console.log(`  ${deck.padEnd(20)} ${String(own.length).padStart(9)}  ${String(forced).padStart(9)}  ` +
            `${String(only).padStart(9)}  ${String(div).padStart(9)}  ${String(atOne).padStart(4)}`);
    }
    console.log('');
}

// Flip outcome per deck. Only seat 0 is treated, so this is causal for deckA.
const byGame = new Map();
for(const e of treated.filter((x) => x.divergent)) {
    byGame.set(e.game, (byGame.get(e.game) || 0) + 1);
}
console.log('outcome, per deck piloted by the TREATED seat (a flip here IS causal)');
console.log(`  ${'deck'.padEnd(20)} games  games w/ switch  flips to / away  net`);
let allTo = 0;
let allAway = 0;
const rows = [];
for(const deck of [...new Set(data.games.map((g) => g.deckA))].sort()) {
    const slice = data.games.filter((g) => g.deckA === deck);
    let withSwitch = 0;
    let to = 0;
    let away = 0;
    for(const game of slice) {
        if(byGame.get(game.game)) {
            withSwitch++;
        }
        if(game.control.winner !== game.treated.winner) {
            if(game.treated.winner === 'Seat0') {
                to++;
            } else {
                away++;
            }
        }
    }
    allTo += to;
    allAway += away;
    rows.push([deck, slice.length, withSwitch, to, away]);
}
for(const [deck, games, withSwitch, to, away] of rows.sort((a, b) => (b[3] - b[4]) - (a[3] - a[4]))) {
    console.log(`  ${deck.padEnd(20)} ${String(games).padStart(5)}  ${String(withSwitch).padStart(15)}  ` +
        `${String(to).padStart(8)} / ${String(away).padStart(4)}  ${to - away > 0 ? '+' : ''}${to - away}`);
}
console.log(`  ${'TOTAL'.padEnd(20)} ${String(data.games.length).padStart(5)}  ` +
    `${String(byGame.size).padStart(15)}  ${String(allTo).padStart(8)} / ${String(allAway).padStart(4)}  ` +
    `${allTo - allAway > 0 ? '+' : ''}${allTo - allAway}`);
