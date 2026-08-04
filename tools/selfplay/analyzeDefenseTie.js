'use strict';
// Reads a probePaired.js dump of `defense-size` events and answers the question
// a win rate cannot: WHAT does the defensive tie-break actually buy and spend?
//
//   node tools/selfplay/analyzeDefenseTie.js probe.json
//
// The lever adds one skill to the defense target when the defense can already
// reach a tie, so it converts "province saved, conflict and ring lost" into
// "province saved, conflict and ring won". Its cost is not one skill: skills
// are integers, so it spends whatever the NEXT body in the sorted candidate
// list is worth, and that body bows on return home.
'use strict';
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(process.argv[2] || 'probe.json', 'utf8'));
const events = data.events;
const games = data.games;

const num = (v) => Number(v) || 0;
const pct = (a, b) => b > 0 ? `${(100 * a / b).toFixed(1)}%` : '—';

// The treated seat is always Seat0 and always pilots deckA.
const treatedSeat = (e) => e.arm === 'treated' && e.seat === 'Seat0';
const controlSeat = (e) => e.arm === 'control' && e.seat === 'Seat0';

const hist = (values) => {
    const map = new Map();
    for(const v of values) {
        map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
};
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

console.log(`games=${games.length} events=${events.length}\n`);

// ---- 1. where do defense decisions land at all ----
for(const [label, filter] of [['CONTROL seat0', controlSeat], ['TREATED seat0', treatedSeat]]) {
    const own = events.filter(filter);
    if(own.length === 0) {
        continue;
    }
    const byBranch = new Map();
    for(const e of own) {
        byBranch.set(e.branch, (byBranch.get(e.branch) || 0) + 1);
    }
    console.log(`${label}: ${own.length} defense-sizing calls`);
    for(const [branch, n] of [...byBranch].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(branch).padEnd(14)} ${String(n).padStart(5)}  ${pct(n, own.length)}`);
    }
    const eligible = own.filter((e) => e.tieBreakEligible);
    const divergent = own.filter((e) => e.divergent);
    const applied = own.filter((e) => e.tieBreakApplied);
    console.log(`    tie-break eligible ${eligible.length}, DIVERGENT (committed skill == attacker skill, ` +
        `one more point available) ${divergent.length}, applied ${applied.length}`);
    const declines = new Map();
    for(const e of own.filter((x) => x.tieBreakDeclined)) {
        declines.set(e.tieBreakDeclined, (declines.get(e.tieBreakDeclined) || 0) + 1);
    }
    if(declines.size) {
        console.log(`    declined: ${[...declines].map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    console.log('');
}

// ---- 2. what the extra point costs, at the windows that actually diverge ----
const divergent = events.filter((e) => treatedSeat(e) && e.divergent);
console.log(`=== the ${divergent.length} divergent windows (treated seat) ===`);
console.log(`marginal body skill (what the extra +1 actually spends):`);
for(const [skill, n] of hist(divergent.map((e) => num(e.marginalSkill)))) {
    console.log(`    ${String(skill).padStart(3)} skill  ${String(n).padStart(4)}  ${pct(n, divergent.length)} ` +
        `${'#'.repeat(Math.round(40 * n / divergent.length))}`);
}
console.log(`  mean ${mean(divergent.map((e) => num(e.marginalSkill))).toFixed(2)} skill spent to buy 1`);
console.log('');
console.log(`conflicts we still have to open ourselves at that moment:`);
for(const [n, count] of hist(divergent.map((e) => num(e.conflictsRemaining)))) {
    console.log(`    ${n} remaining  ${String(count).padStart(4)}  ${pct(count, divergent.length)}`);
}
console.log(`ready bodies not already in the conflict:`);
for(const [n, count] of hist(divergent.map((e) => num(e.readyCount)))) {
    console.log(`    ${n} ready  ${String(count).padStart(4)}  ${pct(count, divergent.length)}`);
}
console.log(`round:`);
for(const [n, count] of hist(divergent.map((e) => num(e.round)))) {
    console.log(`    round ${n}  ${String(count).padStart(4)}  ${pct(count, divergent.length)}`);
}
const byRing = new Map();
for(const e of divergent) {
    byRing.set(e.ringElement || '?', (byRing.get(e.ringElement || '?') || 0) + 1);
}
console.log(`ring at stake: ${[...byRing].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')}`);
const byAxis = new Map();
for(const e of divergent) {
    byAxis.set(e.axis || '?', (byAxis.get(e.axis || '?') || 0) + 1);
}
console.log(`axis: ${[...byAxis].map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log('');

// ---- 3. per-deck: windows opened vs outcome flipped ----
// Only seat 0 is treated, so a flip IS the causal effect for deckA.
const perDeck = new Map();
for(const game of games) {
    const row = perDeck.get(game.deckA) ||
        { games: 0, windows: 0, flipTo: 0, flipAway: 0, marginal: [] };
    row.games++;
    const own = events.filter((e) => e.game === game.game && treatedSeat(e) && e.divergent);
    row.windows += own.length;
    row.marginal.push(...own.map((e) => num(e.marginalSkill)));
    if(game.control.winner !== game.treated.winner) {
        if(game.treated.winner === 'Seat0') {
            row.flipTo++;
        } else {
            row.flipAway++;
        }
    }
    perDeck.set(game.deckA, row);
}
console.log('per deck piloted by the TREATED seat (a flip here IS the causal effect)');
console.log(`  ${'deck'.padEnd(20)} games  windows  win/loss flips  net  mean marginal`);
let totalTo = 0;
let totalAway = 0;
for(const [deck, row] of [...perDeck].sort((a, b) => (b[1].flipTo - b[1].flipAway) - (a[1].flipTo - a[1].flipAway))) {
    totalTo += row.flipTo;
    totalAway += row.flipAway;
    console.log(`  ${deck.padEnd(20)} ${String(row.games).padStart(5)}  ${String(row.windows).padStart(7)}  ` +
        `${String(row.flipTo).padStart(6)}/${String(row.flipAway).padStart(4)}      ` +
        `${String(row.flipTo - row.flipAway).padStart(3)}  ${mean(row.marginal).toFixed(2)}`);
}
console.log(`  ${'TOTAL'.padEnd(20)} ${String(games.length).padStart(5)}  ` +
    `${String(divergent.length).padStart(7)}  ${String(totalTo).padStart(6)}/${String(totalAway).padStart(4)}` +
    `      ${String(totalTo - totalAway).padStart(3)}`);
console.log('');

// ---- 4. does having MORE windows help or hurt? ----
// If the lever were good, games where it fired often should flip toward the
// treated seat more than games where it fired once.
const buckets = [[0, 0], [1, 2], [3, 5], [6, 99]];
console.log('flip direction by how many times the lever fired in that game');
for(const [lo, hi] of buckets) {
    let n = 0;
    let to = 0;
    let away = 0;
    for(const game of games) {
        const count = events.filter((e) => e.game === game.game && treatedSeat(e) && e.divergent).length;
        if(count < lo || count > hi) {
            continue;
        }
        n++;
        if(game.control.winner !== game.treated.winner) {
            if(game.treated.winner === 'Seat0') {
                to++;
            } else {
                away++;
            }
        }
    }
    console.log(`  ${lo}-${hi === 99 ? '+' : hi} windows: ${String(n).padStart(4)} games, ` +
        `flips ${to} to / ${away} away`);
}
