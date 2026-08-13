'use strict';
// EFFECT POLARITY AUDIT — plays the cross-deck field with the polarity monitor
// attached and reports every wrong-side ready/bow/honor/dishonor landing,
// grouped by the card that caused it.
//
// This is the data-collection half of the integration suite in
// test/server/bots/integration/. Run it with RAW=1 to see everything the
// invariant catches, curate the real exceptions into
// test/helpers/polarityallowances.js, then run it again without RAW to confirm
// the remainder is zero.
//
// USAGE
//   RAW=1 BASES=91001 WORKERS=14 OUT=polarity.json node tools/selfplay/auditEffectPolarity.js
//
//   BASES=<csv>   shuffle bases (one base = one full cross-deck pass)
//   ONLY=<csv>    restrict to pairings involving these deck labels
//   RAW=1         ignore the curated allowance list
//   OUT=<path>    write the full violation dump for further analysis
process.env.LOG_LEVEL = 'error';
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DECK_LABELS } = require('./deckRegistry.js');
const { groupBySource } = require('../../test/helpers/effectpolarity.js');

const BASES = String(process.env.BASES || '91001').split(',').map(Number);
const OUT = process.env.OUT || '';
const RAW = process.env.RAW === '1';
const WORKERS = Number(process.env.WORKERS || Math.max(1, require('os').cpus().length - 4));
const ONLY = String(process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const unknown = ONLY.filter((label) => !DECK_LABELS.includes(label));
if(unknown.length > 0) {
    throw new Error(`ONLY names decks that do not exist: ${unknown.join(', ')}`);
}

const tasks = [];
for(const base of BASES) {
    for(let i = 0; i < DECK_LABELS.length; i++) {
        for(let j = 0; j < DECK_LABELS.length; j++) {
            if(i === j) {
                continue;
            }
            if(ONLY.length > 0 && !ONLY.includes(DECK_LABELS[i]) && !ONLY.includes(DECK_LABELS[j])) {
                continue;
            }
            tasks.push({ base: base, i: i, j: j });
        }
    }
}
const shards = Array.from({ length: WORKERS }, () => []);
tasks.forEach((task, idx) => shards[idx % WORKERS].push(task));

const runShard = (shard, idx) => new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, '_polarityWorker.js'), [], {
        env: Object.assign({}, process.env, {
            TASKS: JSON.stringify(shard),
            RAW: RAW ? '1' : '0',
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
        const line = out.split('\n').find((l) => l.startsWith('@@RESULT@@'));
        if(!line) {
            return reject(new Error(`worker ${idx} produced no result line: ${out.slice(-400)}`));
        }
        resolve(JSON.parse(line.slice('@@RESULT@@'.length)));
    });
});

(async () => {
    const started = Date.now();
    const results = await Promise.all(shards.filter((shard) => shard.length > 0).map(runShard));
    const violations = results.flatMap((r) => r.violations);
    const exempt = results.flatMap((r) => r.exempt);
    const totals = results.reduce((acc, r) => {
        for(const key of Object.keys(r.totals)) {
            acc[key] = (acc[key] || 0) + r.totals[key];
        }
        return acc;
    }, {});

    console.log(`bases=${BASES.join(',')} games=${totals.games} raw=${RAW} ` +
        `wall=${((Date.now() - started) / 60000).toFixed(1)}min`);
    console.log(`landings: ready=${totals.ready} bow=${totals.bow} ` +
        `honor=${totals.honor} dishonor=${totals.dishonor}`);
    console.log(`violations=${violations.length} ` +
        `(avoidable ${violations.filter((v) => v.avoidable).length}) exempted=${exempt.length}`);

    const grouped = groupBySource(violations);
    console.log('\nsource                                   rule            count  avoid  decks');
    for(const entry of grouped) {
        console.log(
            `${String(entry.sourceId || 'null').padEnd(40)} ${entry.key.padEnd(15)} ` +
            `${String(entry.count).padStart(5)}  ${String(entry.avoidable).padStart(5)}  ` +
            `${[...entry.decks].slice(0, 4).join(',')}`
        );
    }

    const byExemption = exempt.reduce((acc, entry) => {
        const key = `${entry.exemption} ${entry.action}:${entry.landedOn}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    console.log('\nexemptions applied:');
    for(const [key, count] of Object.entries(byExemption).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${key.padEnd(40)} ${count}`);
    }

    if(OUT) {
        fs.writeFileSync(OUT, JSON.stringify({
            bases: BASES, raw: RAW, totals: totals, violations: violations
        }));
        console.log(`\n-> ${OUT}`);
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
