'use strict';
// POPULATION of the free-conflict window (`UnopposedWindowPolicy`).
//
//   node tools/selfplay/analyzeUnopposed.js probe.json [seat]
//
// The owner's own expectation for this lever was "I don't expect this to occur
// very often", so the population IS the first result: how often the bot reaches
// a conflict-phase window with a conflict opportunity left, and what closed the
// window when it did not fire. A lever that never fires cannot be measured, and
// tuning its values cannot help.
//
// `BotTelemetry` is a global static sink and records BOTH players, so filter by
// seat before reading any rate as "the treated bot's".
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SEAT = `Seat${process.argv[3] || 0}`;
const events = data.events.filter((e) => e.kind === 'unopposed-window' || e.reason);
const treated = events.filter((e) => e.arm === 'treated' && e.seat === SEAT);

const pct = (n, d) => `${(100 * n / Math.max(1, d)).toFixed(1)}%`;
const tally = (list, key) => {
    const out = new Map();
    for(const e of list) {
        const k = String(e[key]);
        out.set(k, (out.get(k) || 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`CHANGE=${data.change}`);
console.log(`games=${data.games.length} window looks (treated, ${SEAT})=${treated.length}\n`);

console.log('why the window closed (or opened):');
for(const [reason, n] of tally(treated, 'reason')) {
    console.log(`  ${reason.padEnd(24)} ${String(n).padStart(6)} (${pct(n, treated.length)})`);
}

const fired = treated.filter((e) => e.divergent);
console.log(`\nFIRED in ${fired.length} windows (${pct(fired.length, treated.length)})`);
if(fired.length === 0) {
    // The gate that closed it most often is the one to relax, not the values.
    console.log('  nothing to tune: relax the gate, or the lever is unreachable.');
    process.exit(0);
}
const gamesWithPlay = new Set(fired.map((e) => e.game));
console.log(`  across ${gamesWithPlay.size} of ${data.games.length} games ` +
    `(${pct(gamesWithPlay.size, data.games.length)})`);

console.log('\ncards played:');
for(const [id, n] of tally(fired, 'playedId')) {
    const rows = fired.filter((e) => e.playedId === id);
    const skill = rows.reduce((s, e) => s + (Number(e.skill) || 0), 0) / rows.length;
    const cost = rows.reduce((s, e) => s + Math.max(0, Number(e.playedCost) || 0), 0) / rows.length;
    console.log(`  ${String(id).padEnd(28)} ${String(n).padStart(4)}  mean skill ${skill.toFixed(1)}  mean cost ${cost.toFixed(1)}`);
}

console.log('\nround it fired in:');
for(const [round, n] of tally(fired, 'round').sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  round ${round.padEnd(4)} ${String(n).padStart(4)} (${pct(n, fired.length)})`);
}

const board = (key) => {
    const total = fired.reduce((s, e) => s + (Number(e[key]) || 0), 0);
    return (total / fired.length).toFixed(2);
};
console.log(`\nboard when it fired: opponentInPlay ${board('opponentInPlay')} ` +
    `(all bowed), myReady ${board('myReady')}, fate ${board('availableFate')}, ` +
    `hand bodies ${board('candidates')}`);

// A game the change TOUCHED is the only game that can carry information about
// it; the rest are shared shuffle. Report the ceiling the same way probePaired
// reports its own, so the two numbers are comparable.
const decided = data.games.filter((g) => g.control.winner !== g.treated.winner);
console.log(`\nceiling: ${decided.length} of ${data.games.length} games flip ` +
    `(${pct(decided.length, data.games.length)}) = ` +
    `${(50 * decided.length / Math.max(1, data.games.length)).toFixed(2)}pp`);
