'use strict';
// POPULATION of the declaration-time board read (`ConflictTempoPolicy`).
//
//   node tools/selfplay/analyzeTempo.js probe.json [seat]
//
// Answers the question that has to come before any win-rate run here: how often
// is each stance actually read, at which decision site, and how often does the
// derived decision DIVERGE from V1? A lever whose stance never fires cannot be
// measured, and a full measurement cycle has already been spent on a mechanism
// that turned out to be unreachable.
//
// `BotTelemetry` is a global static sink and records BOTH players, so filter by
// seat before reading any rate as "the treated bot's".
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SEAT = `Seat${process.argv[3] || 0}`;
const events = data.events.filter((e) => e.kind === 'conflict-tempo' || e.site);
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
console.log(`games=${data.games.length} tempo events (treated, ${SEAT})=${treated.length}\n`);

console.log('by decision site:');
for(const [site, n] of tally(treated, 'site')) {
    console.log(`  ${site.padEnd(10)} ${String(n).padStart(6)} (${pct(n, treated.length)})`);
}

console.log('\nstance, per site:');
for(const [site] of tally(treated, 'site')) {
    const rows = treated.filter((e) => e.site === site);
    const parts = tally(rows, 'stance')
        .map(([s, n]) => `${s} ${pct(n, rows.length)}`).join('   ');
    console.log(`  ${site.padEnd(10)} ${parts}`);
}

const divergent = treated.filter((e) => e.divergent);
console.log(`\ndiverges from V1 in ${divergent.length} windows (${pct(divergent.length, treated.length)})`);
if(divergent.length > 0) {
    const gamesWithWindow = new Set(divergent.map((e) => e.game)).size;
    console.log(`  across ${gamesWithWindow} of ${data.games.length} games ` +
        `(${pct(gamesWithWindow, data.games.length)})`);
    for(const [reason, n] of tally(divergent, 'reason')) {
        console.log(`  ${reason.padEnd(18)} ${String(n).padStart(6)}`);
    }
    const which = ['defenseWinOnly', 'attackSendAll'];
    for(const field of which) {
        const n = divergent.filter((e) => e[field]).length;
        if(n > 0) {
            console.log(`  ${field.padEnd(18)} ${String(n).padStart(6)}`);
        }
    }
    const ring = divergent.filter((e) => e.readyRingBonus > 0);
    if(ring.length > 0) {
        const avg = ring.reduce((s, e) => s + e.readyRingBonus, 0) / ring.length;
        console.log(`  readyRingBonus     ${String(ring.length).padStart(6)}  mean ${avg.toFixed(1)}`);
    }
    const hold = divergent.filter((e) => e.attackKeepHome > 0).length;
    if(hold > 0) {
        console.log(`  attackKeepHome     ${String(hold).padStart(6)}`);
    }
}

// The first-player projection is a board fact, not a lever: report it so the
// dynasty arms can be read against how often the bot is second player.
const second = treated.filter((e) => !e.isFirstPlayer).length;
console.log(`\nsecond player (so first NEXT round) in ${pct(second, treated.length)} of windows`);
