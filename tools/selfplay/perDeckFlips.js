'use strict';
// PER-DECK CAUSAL EFFECT of a lever, from one or more probePaired dumps.
//
//   node tools/selfplay/perDeckFlips.js seat0.json seat1.json ...
//
// A head-to-head's per-deck rows are DECK STRENGTH against the field, not the
// change — a validated null arm still swings +-28pp on them. The paired probe
// treats one seat and never swaps it, so a flip in a pairing where the TREATED
// seat pilots deck D is caused by the lever acting on deck D. That is the only
// rig here that can answer "how did this change each deck".
//
// It still inherits the probe's seat bias: pass BOTH a SEAT=0 and a SEAT=1 dump
// and the seat term cancels, exactly as it does in the head-to-head. The script
// reads each dump's own treated seat out of the file, so the order does not
// matter and mixing them is the point.
//
// Effect convention matches the rest of the project: 50 * (to - away) / games,
// which is what `probePaired.js` reports as its ceiling.
const fs = require('fs');

// Two-sided binomial sign test on the discordant pairs (McNemar's exact test).
const logChoose = (n, k) => {
    let out = 0;
    for(let i = 1; i <= k; i++) {
        out += Math.log(n - k + i) - Math.log(i);
    }
    return out;
};
const signTest = (to, away) => {
    const n = to + away;
    if(n === 0) {
        return 1;
    }
    const k = Math.min(to, away);
    let tail = 0;
    for(let i = 0; i <= k; i++) {
        tail += Math.exp(logChoose(n, i) - n * Math.log(2));
    }
    return Math.min(1, 2 * tail);
};

const files = process.argv.slice(2);
if(files.length === 0) {
    console.error('usage: node perDeckFlips.js <probe dump>...');
    process.exit(1);
}

const byDeck = new Map();
const totals = { games: 0, to: 0, away: 0 };
const seats = new Set();
let change = '';
for(const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    change = change || data.change;
    // The dump does not name its seat, so derive it: every treated winner label
    // that differs from control tells us nothing, but the games list carries
    // deckA/deckB and the probe only ever treats one of them. Fall back to the
    // filename, which the sweep scripts label.
    const seat = /seat1/i.test(file) ? 1 : 0;
    seats.add(seat);
    const winner = `Seat${seat}`;
    for(const game of data.games) {
        const deck = seat === 1 ? game.deckB : game.deckA;
        const row = byDeck.get(deck) || { games: 0, to: 0, away: 0 };
        row.games++;
        totals.games++;
        if(game.control.winner !== game.treated.winner) {
            if(game.treated.winner === winner) {
                row.to++;
                totals.to++;
            } else {
                row.away++;
                totals.away++;
            }
        }
        byDeck.set(deck, row);
    }
}

const effect = (row) => 50 * (row.to - row.away) / Math.max(1, row.games);
const rows = [...byDeck.entries()].sort((a, b) => effect(b[1]) - effect(a[1]));

console.log(`CHANGE=${change}`);
console.log(`files=${files.length} seats=${[...seats].sort().join('+')} games=${totals.games}\n`);
console.log('deck                  games  decided   to  away   effect      p');
console.log('-'.repeat(68));
for(const [deck, row] of rows) {
    const decided = row.to + row.away;
    console.log(`${deck.padEnd(20)} ${String(row.games).padStart(6)} ` +
        `${String(decided).padStart(8)} ${String(row.to).padStart(4)} ${String(row.away).padStart(5)} ` +
        `${effect(row).toFixed(2).padStart(8)}pp ${signTest(row.to, row.away).toFixed(3).padStart(6)}`);
}
console.log('-'.repeat(68));
const decided = totals.to + totals.away;
console.log(`${'TOTAL'.padEnd(20)} ${String(totals.games).padStart(6)} ` +
    `${String(decided).padStart(8)} ${String(totals.to).padStart(4)} ${String(totals.away).padStart(5)} ` +
    `${effect(totals).toFixed(2).padStart(8)}pp ${signTest(totals.to, totals.away).toFixed(4).padStart(6)}`);
console.log(`\nCEILING ${(50 * decided / Math.max(1, totals.games)).toFixed(2)}pp ` +
    `(${(100 * decided / Math.max(1, totals.games)).toFixed(1)}% of games flipped)`);
console.log('Per-deck rows here ARE causal (one treated seat), but each is a small n:');
console.log('treat a deck row as a hypothesis for a scoped arm, not as a result.');
