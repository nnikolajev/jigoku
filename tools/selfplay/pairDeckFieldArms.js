'use strict';

// Pair two `deckFieldWinRate.js` row dumps game-for-game and report the delta,
// the flip rate and a paired sign test.
//
// WHY THIS EXISTS
//
// `deckFieldWinRate.js` prints one arm's win rate against a fixed field. A DECK
// CONTENT change (a swapped card, a different stronghold province) cannot be
// injected as a `SUBJECT_PROFILE` — that path is not bit-clean, its null arm
// diverges — so the two arms are two BUILDS, and the only honest comparison is
// the paired one: the same (base, opponent, subjectSeat) slot in both dumps.
//
// Pairing preserves ORDER within a key, because `GPB > 1` puts several games
// under one key and a dict keyed on it silently drops the rest.
//
// The flip count is the information in the run. Games that land the same way in
// both arms carry none, so the sign test over the flips resolves an effect far
// below what the raw win-rate difference can.
//
// USAGE
//   node tools/selfplay/pairDeckFieldArms.js control.json treated.json [...more]
//
// Several dumps may be passed per side by repeating the pair:
//   node tools/selfplay/pairDeckFieldArms.js a1.json b1.json a2.json b2.json

const fs = require('fs');

function load(file) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { label: parsed.label || file, subject: parsed.subject, rows: parsed.rows || [] };
}

function bucket(rows) {
    const byKey = new Map();
    for(const row of rows) {
        const key = `${row.base}|${row.opponent}|${row.subjectSeat}`;
        if(!byKey.has(key)) {
            byKey.set(key, []);
        }
        byKey.get(key).push(row);
    }
    return byKey;
}

function pair(control, treated) {
    const left = bucket(control.rows);
    const right = bucket(treated.rows);
    const pairs = [];
    let unmatched = 0;
    for(const [key, rows] of left) {
        const others = right.get(key) || [];
        const shared = Math.min(rows.length, others.length);
        unmatched += Math.abs(rows.length - others.length);
        for(let i = 0; i < shared; i++) {
            pairs.push({ key, control: rows[i], treated: others[i] });
        }
    }
    for(const [key, rows] of right) {
        if(!left.has(key)) {
            unmatched += rows.length;
        }
    }
    return { pairs, unmatched };
}

function normalCdf(z) {
    // Abramowitz & Stegun 7.1.26 on erf, good to ~1e-7 — enough for a p-value
    // that is only ever compared against 0.05.
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
        0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
}

function main(argv = process.argv.slice(2)) {
    if(argv.length < 2 || argv.length % 2 !== 0) {
        throw new Error('Usage: pairDeckFieldArms <control.json> <treated.json> [<control2.json> <treated2.json> ...]');
    }

    let allPairs = [];
    let unmatched = 0;
    let controlLabel = '';
    let treatedLabel = '';
    for(let i = 0; i < argv.length; i += 2) {
        const control = load(argv[i]);
        const treated = load(argv[i + 1]);
        if(control.subject !== treated.subject) {
            throw new Error(`Subject mismatch: ${control.subject} vs ${treated.subject}`);
        }
        controlLabel = controlLabel || control.label;
        treatedLabel = treatedLabel || treated.label;
        const paired = pair(control, treated);
        allPairs = allPairs.concat(paired.pairs);
        unmatched += paired.unmatched;
    }

    const played = allPairs.length;
    const controlWins = allPairs.reduce((sum, p) => sum + p.control.subjectWon, 0);
    const treatedWins = allPairs.reduce((sum, p) => sum + p.treated.subjectWon, 0);
    const to = allPairs.filter((p) => p.treated.subjectWon > p.control.subjectWon).length;
    const away = allPairs.filter((p) => p.treated.subjectWon < p.control.subjectWon).length;
    const decided = to + away;
    const identical = allPairs.filter((p) =>
        p.control.subjectWon === p.treated.subjectWon &&
        p.control.rounds === p.treated.rounds &&
        p.control.reason === p.treated.reason).length;

    const z = decided > 0 ? (to - away) / Math.sqrt(decided) : 0;
    const p = 2 * (1 - normalCdf(Math.abs(z)));
    const delta = played > 0 ? 100 * (treatedWins - controlWins) / played : 0;

    console.log(`control ${controlLabel}: ${controlWins}-${played - controlWins}  ${(100 * controlWins / played).toFixed(2)}%`);
    console.log(`treated ${treatedLabel}: ${treatedWins}-${played - treatedWins}  ${(100 * treatedWins / played).toFixed(2)}%`);
    console.log(`paired games ${played} (unmatched ${unmatched})`);
    console.log(`delta ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp`);
    console.log(`bit-identical outcomes ${identical}/${played} (${(100 * identical / played).toFixed(1)}%)  ` +
        `=> ceiling ${(100 * decided / played / 2).toFixed(2)}pp`);
    console.log(`paired flips: ${to} to / ${away} away, ${decided} decided, z=${z.toFixed(2)}, p=${p.toFixed(4)}`);

    const bases = [...new Set(allPairs.map((p) => p.control.base))].sort((a, b) => a - b);
    console.log('\nper base (control -> treated)');
    for(const base of bases) {
        const slice = allPairs.filter((entry) => entry.control.base === base);
        const c = slice.reduce((sum, entry) => sum + entry.control.subjectWon, 0);
        const t = slice.reduce((sum, entry) => sum + entry.treated.subjectWon, 0);
        const sign = t === c ? ' ' : t > c ? '+' : '-';
        console.log(`  ${base}  ${c}/${slice.length} -> ${t}/${slice.length}  ${sign}`);
    }

    console.log('\nper opponent (control -> treated)');
    const opponents = [...new Set(allPairs.map((entry) => entry.control.opponent))].sort();
    for(const opponent of opponents) {
        const slice = allPairs.filter((entry) => entry.control.opponent === opponent);
        const c = slice.reduce((sum, entry) => sum + entry.control.subjectWon, 0);
        const t = slice.reduce((sum, entry) => sum + entry.treated.subjectWon, 0);
        console.log(`  ${opponent.padEnd(20)} ${String(c).padStart(3)}/${String(slice.length).padStart(3)} -> ${String(t).padStart(3)}/${String(slice.length).padStart(3)}`);
    }

    const reasons = {};
    for(const entry of allPairs) {
        const key = `${entry.control.subjectWon ? 'win' : 'loss'}:${entry.control.reason || 'none'}`;
        reasons[key] = reasons[key] || [0, 0];
        reasons[key][0]++;
    }
    for(const entry of allPairs) {
        const key = `${entry.treated.subjectWon ? 'win' : 'loss'}:${entry.treated.reason || 'none'}`;
        reasons[key] = reasons[key] || [0, 0];
        reasons[key][1]++;
    }
    console.log('\nwin reasons (control -> treated)');
    for(const key of Object.keys(reasons).sort()) {
        console.log(`  ${key.padEnd(24)} ${String(reasons[key][0]).padStart(4)} -> ${String(reasons[key][1]).padStart(4)}`);
    }
}

if(require.main === module) {
    try {
        main();
    } catch(error) {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { main, pair, bucket };
