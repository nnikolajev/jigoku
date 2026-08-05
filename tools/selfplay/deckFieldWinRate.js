'use strict';
// ONE DECK against the FIXED field, sharded across worker processes.
//
// WHY THIS EXISTS, AND WHAT IT IS NOT
//
// `headToHeadRoundRobin.js` answers "is the CHANGED bot stronger than the
// unchanged bot" and its null is a hard 50%. That is the right rig for a
// change to shared policy, and the wrong one for a NEW DECK: there is no
// unchanged counterpart to play against, and a field round robin that moves
// every seat is zero-sum, so it can never say a deck is good.
//
// Here exactly one deck varies and the other ten are held fixed, so the number
// is that deck's strength against a stationary field. It is NOT centred on 50%
// — a deck can be well-built and still sit under 50% against ten opponents that
// have each been tuned for months.
//
// Everything else follows `.claude/skills/roundrobin/SKILL.md`:
//   * every opponent in the registry, mirrors excluded;
//   * each pairing played TWICE on the SAME shuffle, subject on seat 0 then on
//     seat 1, so first-player advantage cancels by construction;
//   * multiple independent shuffle bases, reported per base as well as pooled —
//     three bases can REJECT a variant, six are needed to accept one;
//   * per-opponent rows are printed, but the TOTAL is the result.
//
// USAGE
//   SUBJECT=PhoenixPhoenix BASES=91001,92001,93001 GPB=2 \
//     node tools/selfplay/deckFieldWinRate.js
//
//   SUBJECT=<label>          deck under test (default PhoenixPhoenix)
//   BASES=<csv>              independent shuffle bases
//   GPB=<n>                  extra games per opponent per base (each adds 2)
//   WORKERS=<n>              forked processes; leave cores free, the harness
//                            has a wall-clock per-game backstop
//   SUBJECT_PROFILE=<json>   inject a V2 pass-through profile into the SUBJECT
//                            seat only, for A/B tuning of a deck knob. Example:
//                            '{"deckProfile":{"rebirth":{"fushichoAdditionalFate":1}}}'
//                            An arm injected at its own DEFAULT must reproduce
//                            the no-profile run exactly; verify that first.
//   OUT=<path>               also write the per-game rows as JSON
process.env.LOG_LEVEL = 'error';
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DECK_LABELS } = require('./deckRegistry.js');

const SUBJECT = process.env.SUBJECT || 'PhoenixPhoenix';
const BASES = String(process.env.BASES || '91001,92001,93001').split(',').map(Number);
const GPB = Number(process.env.GPB || 1);
const LABEL = process.env.LABEL || SUBJECT;
const OUT = process.env.OUT || '';
const SUBJECT_PROFILE = process.env.SUBJECT_PROFILE || '';
const WORKERS = Number(process.env.WORKERS || Math.max(1, require('os').cpus().length - 4));

if(!DECK_LABELS.includes(SUBJECT)) {
    console.error(`Unknown subject deck ${SUBJECT}. Known: ${DECK_LABELS.join(', ')}`);
    process.exit(1);
}
const OPPONENTS = DECK_LABELS.filter((label) => label !== SUBJECT);

const tasks = [];
for(const base of BASES) {
    OPPONENTS.forEach((opponent, index) => tasks.push({ base, opponent, index }));
}
const shards = Array.from({ length: WORKERS }, () => []);
tasks.forEach((task, idx) => shards[idx % WORKERS].push(task));

const runShard = (shard, idx) => new Promise((resolve, reject) => {
    if(shard.length === 0) {
        return resolve({ rows: [], draws: 0, stops: {} });
    }
    const child = fork(path.join(__dirname, '_fieldWorker.js'), [], {
        env: Object.assign({}, process.env, {
            SUBJECT,
            SUBJECT_PROFILE,
            TASKS: JSON.stringify(shard),
            GPB: String(GPB),
            HARNESS_MAX_GAME_MS: process.env.HARNESS_MAX_GAME_MS || '180000'
        }),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
        out += chunk;
    });
    child.stderr.on('data', (chunk) => process.stderr.write(`w${idx}: ${chunk}`));
    child.on('exit', (code) => {
        if(code !== 0) {
            return reject(new Error(`worker ${idx} exited ${code}`));
        }
        process.stderr.write(`worker ${idx} done (${shard.length} pairings)\n`);
        const line = out.split('\n').find((l) => l.startsWith('@@RESULT@@'));
        if(!line) {
            return reject(new Error(`worker ${idx} produced no result line: ${out.slice(-400)}`));
        }
        try {
            resolve(JSON.parse(line.slice('@@RESULT@@'.length)));
        } catch(parseError) {
            reject(new Error(`worker ${idx} bad output (${parseError.message}): ${line.slice(0, 400)}`));
        }
    });
});

function rate(rows) {
    const wins = rows.reduce((sum, row) => sum + row.subjectWon, 0);
    return { wins, played: rows.length, pct: rows.length > 0 ? 100 * wins / rows.length : 0 };
}

(async () => {
    const started = Date.now();
    const results = await Promise.all(shards.map(runShard));
    const rows = results.flatMap((r) => r.rows);
    const draws = results.reduce((sum, r) => sum + r.draws, 0);
    const stops = {};
    for(const r of results) {
        for(const [key, value] of Object.entries(r.stops)) {
            stops[key] = (stops[key] || 0) + value;
        }
    }

    const total = rate(rows);
    // Wilson 95% interval: at these sample sizes the normal approximation on a
    // proportion near the tails is optimistic, and the whole point of printing
    // an interval is to stop a 20-game row being read as a result.
    const z = 1.96;
    const p = total.played > 0 ? total.wins / total.played : 0;
    const denom = 1 + z * z / total.played;
    const centre = (p + z * z / (2 * total.played)) / denom;
    const spread = z * Math.sqrt(p * (1 - p) / total.played + z * z / (4 * total.played * total.played)) / denom;

    console.log(`SUBJECT=${LABEL}${SUBJECT_PROFILE ? ` PROFILE=${SUBJECT_PROFILE}` : ''}`);
    console.log(`bases=${BASES.join(',')} gamesPerOpponentPerBase=${GPB * 2} opponents=${OPPONENTS.length} ` +
        `workers=${WORKERS} draws=${draws} wall=${((Date.now() - started) / 60000).toFixed(1)}min`);
    console.log(`TOTAL ${total.wins}-${total.played - total.wins} of ${total.played}  ${total.pct.toFixed(2)}%  ` +
        `95% CI [${(100 * (centre - spread)).toFixed(1)}, ${(100 * (centre + spread)).toFixed(1)}]`);
    console.log(`stopReasons ${JSON.stringify(stops)}`);

    console.log('\nper base');
    for(const base of BASES) {
        const slice = rate(rows.filter((row) => row.base === base));
        console.log(`  ${base}  ${slice.wins}-${slice.played - slice.wins}  ${slice.pct.toFixed(2)}%`);
    }

    console.log('\nper seat (a large gap here means the deck is order-dependent, not that the rig is wrong)');
    for(const seat of [0, 1]) {
        const slice = rate(rows.filter((row) => row.subjectSeat === seat));
        console.log(`  seat ${seat}  ${slice.wins}-${slice.played - slice.wins}  ${slice.pct.toFixed(2)}%`);
    }

    console.log('\nper opponent');
    for(const opponent of OPPONENTS) {
        const slice = rate(rows.filter((row) => row.opponent === opponent));
        if(slice.played === 0) {
            continue;
        }
        console.log(`  ${opponent.padEnd(20)} ${String(slice.wins).padStart(4)}/${String(slice.played).padStart(4)}  ${slice.pct.toFixed(1)}%`);
    }

    const reasons = {};
    for(const row of rows) {
        const key = `${row.subjectWon ? 'win' : 'loss'}:${row.reason || 'none'}`;
        reasons[key] = (reasons[key] || 0) + 1;
    }
    console.log(`\nwin reasons ${JSON.stringify(reasons)}`);
    console.log(`avg rounds ${(rows.reduce((sum, row) => sum + row.rounds, 0) / Math.max(rows.length, 1)).toFixed(1)}`);

    if(OUT) {
        fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, subject: SUBJECT, profile: SUBJECT_PROFILE, rows }));
        console.log(`\nrows -> ${OUT}`);
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
