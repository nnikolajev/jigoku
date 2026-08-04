'use strict';
// Which SCOPE would have made a lever pay?
//
// A probePaired.js dump knows, for every game, both outcomes and every decision
// event the lever produced. If the lever is worth anything at all it is worth
// something in a SUBSET of its windows, and this finds that subset: it buckets
// the decided games by an attribute of the windows that fired in them and reads
// the flip direction per bucket.
//
//   node tools/selfplay/crossTabFlips.js probe.json marginalSkill readyCount ...
//
// Read this as hypothesis generation, never as a result. Slicing 70 decided
// games ten ways will always turn up a bucket that looks great; the bucket is a
// candidate for a scoped arm, and the scoped arm still has to win its own
// head-to-head on fresh bases.
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const FIELDS = process.argv.slice(3);
const events = data.events.filter((e) => e.arm === 'treated' && e.seat === 'Seat0' && e.divergent);
const byGame = new Map();
for(const e of events) {
    const list = byGame.get(e.game) || [];
    list.push(e);
    byGame.set(e.game, list);
}

const decided = data.games.filter((g) => g.control.winner !== g.treated.winner);
console.log(`games=${data.games.length} with>=1 window=${byGame.size} decided(flipped)=${decided.length}`);
const flipTo = decided.filter((g) => g.treated.winner === 'Seat0').length;
console.log(`overall flips: ${flipTo} to the changed seat, ${decided.length - flipTo} away ` +
    `(sign test needs ~30 decided games to see 1pp)\n`);

// A game whose windows all sit inside a scope is a game a scoped arm would
// still have played the same way; a game with any window outside it is one the
// scope would have changed. Bucketing on the EXTREMES is therefore the useful
// cut, not the mean.
const stat = (list, field, how) => {
    const values = list.map((e) => Number(e[field]) || 0);
    return how === 'max' ? Math.max(...values) : Math.min(...values);
};

// Categorical fields cannot be min/max'd; bucket each window on its own value
// and let one game contribute to several buckets.
const CATEGORICAL = new Set(['ringElement', 'axis', 'mode', 'branch', 'reason', 'deckA']);
for(const field of FIELDS.filter((f) => CATEGORICAL.has(f))) {
    console.log(`=== ${field} (per WINDOW; a game with mixed windows counts in each) ===`);
    const rows = new Map();
    for(const game of data.games) {
        const list = byGame.get(game.game);
        if(!list) {
            continue;
        }
        const flipped = game.control.winner !== game.treated.winner;
        const toChanged = flipped && game.treated.winner === 'Seat0';
        for(const key of new Set(list.map((e) => String(e[field] ?? game[field] ?? '?')))) {
            const row = rows.get(key) || { games: 0, to: 0, away: 0, windows: 0 };
            row.games++;
            row.windows += list.filter((e) => String(e[field] ?? game[field] ?? '?') === key).length;
            if(flipped) {
                row[toChanged ? 'to' : 'away']++;
            }
            rows.set(key, row);
        }
    }
    for(const [key, row] of [...rows].sort((a, b) => (b[1].to - b[1].away) - (a[1].to - a[1].away))) {
        const net = row.to - row.away;
        console.log(`  ${String(key).padEnd(18)} windows ${String(row.windows).padStart(4)}  ` +
            `games ${String(row.games).padStart(4)}  flips ${String(row.to).padStart(3)}/${String(row.away).padStart(3)}  ` +
            `net ${net > 0 ? '+' : ''}${net}`);
    }
    console.log('');
}

for(const field of FIELDS.filter((f) => !CATEGORICAL.has(f))) {
    const how = field === 'readyCount' || field === 'conflictsRemaining' ? 'min' : 'max';
    console.log(`=== ${field} (${how} over the windows in each game) ===`);
    const rows = new Map();
    for(const game of data.games) {
        const list = byGame.get(game.game);
        if(!list) {
            continue;
        }
        const key = stat(list, field, how);
        const row = rows.get(key) || { games: 0, to: 0, away: 0 };
        row.games++;
        if(game.control.winner !== game.treated.winner) {
            if(game.treated.winner === 'Seat0') {
                row.to++;
            } else {
                row.away++;
            }
        }
        rows.set(key, row);
    }
    for(const [key, row] of [...rows].sort((a, b) => a[0] - b[0])) {
        const net = row.to - row.away;
        console.log(`  ${field}=${String(key).padStart(3)}  games ${String(row.games).padStart(4)}  ` +
            `flips ${String(row.to).padStart(3)} to / ${String(row.away).padStart(3)} away  net ${net > 0 ? '+' : ''}${net}`);
    }
    // Cumulative view: what a "<= k" scope would have scored on the games it
    // still fires in. This is the number a capped knob would produce, on THESE
    // bases, which is exactly why it needs re-measuring on other ones.
    console.log(`  cumulative "${field} ${how === 'max' ? '<=' : '>='} k" scope:`);
    const keys = [...rows.keys()].sort((a, b) => a - b);
    const ordered = how === 'max' ? keys : keys.slice().reverse();
    let games = 0;
    let to = 0;
    let away = 0;
    for(const key of ordered) {
        const row = rows.get(key);
        games += row.games;
        to += row.to;
        away += row.away;
        console.log(`    ${how === 'max' ? '<=' : '>='}${String(key).padStart(3)}  fires in ${String(games).padStart(4)} games  ` +
            `flips ${String(to).padStart(3)}/${String(away).padStart(3)}  net ${to - away > 0 ? '+' : ''}${to - away}`);
    }
    console.log('');
}
