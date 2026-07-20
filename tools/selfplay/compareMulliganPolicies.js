'use strict';

// Direct adaptive-vs-legacy mulligan A/B. Both seats use the same deck and bot
// seed; seats alternate and every game gets a deterministic shuffle seed. This
// isolates opening mulligan/end-fate refresh behavior and never updates the
// standardized client benchmark JSON.

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function usage() {
    return `Usage: node tools/selfplay/compareMulliganPolicies.js [options]

Options:
  --games <n>       Games per deck and seed (default 20)
  --seeds <csv>     Bot seeds on both seats (default 1,2,3)
  --decks <csv>     Deck labels (default all)
  --rng-seed <n>    Deterministic base RNG seed (default 20260720)
  --out <prefix>    Report prefix (default tools/selfplay/out/mulligan-ab)
  --help            Show help

Deck labels: ${DECK_LABELS.join(', ')}`;
}

function positiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if(!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

function csv(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseArgs(argv) {
    const options = {
        games: 20,
        seeds: [1, 2, 3],
        decks: [...DECK_LABELS],
        rngSeed: 20260720,
        out: path.join(__dirname, 'out', 'mulligan-ab'),
        help: false
    };
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
        } else if(arg === '--games') {
            options.games = positiveInteger(argv[++index], arg);
        } else if(arg === '--seeds') {
            options.seeds = csv(argv[++index]).map((seed) => positiveInteger(seed, arg));
        } else if(arg === '--rng-seed') {
            options.rngSeed = positiveInteger(argv[++index], arg);
        } else if(arg === '--decks') {
            options.decks = csv(argv[++index]);
        } else if(arg === '--out') {
            options.out = argv[++index];
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }
    if(options.seeds.length === 0 || options.seeds.some((seed) => seed > 3)) {
        throw new Error('--seeds must be a comma-separated subset of 1,2,3');
    }
    const unknown = options.decks.filter((label) => !DECK_LABELS.includes(label));
    if(options.decks.length === 0 || unknown.length > 0) {
        throw new Error(`Unknown deck. Valid: ${DECK_LABELS.join(', ')}`);
    }
    return options;
}

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}

function addDecisionStats(counts, controller) {
    for(const entry of controller?.trace || []) {
        if(entry.command !== 'cardClicked' ||
            !/(mulligan|adaptive-discard|dynasty-discard)/i.test(String(entry.reason || ''))) {
            continue;
        }
        const key = `${entry.reason}: ${entry.target || entry.args?.[0] || 'unknown'}`;
        counts[key] = (counts[key] || 0) + 1;
    }
}

function topDecisions(counts, limit = 5) {
    return Object.entries(counts || {}).sort((left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0])
    ).slice(0, limit).map(([decision, count]) => `${decision} x${count}`);
}

function markdown(report) {
    const lines = [
        '# Mulligan policy direct A/B', '',
        `Seeds: ${report.config.seeds.join(', ')}; games per deck/seed: ${report.config.games}; RNG seed: ${report.config.rngSeed}`,
        'Adaptive and legacy use the same deck and seed. Seats alternate.', '',
        '| Seed | Deck | Adaptive record | Adaptive win rate |',
        '|---:|---|---:|---:|'
    ];
    for(const row of report.rows) {
        lines.push(`| ${row.seed} | ${row.deck} | ${row.adaptiveWins}-${row.legacyWins} (+${row.other}) | ${(row.adaptiveWinRate * 100).toFixed(1)}% |`);
    }
    for(const row of report.rows) {
        const top = topDecisions(row.adaptiveDecisions);
        if(top.length > 0) {
            lines.push('', `Seed ${row.seed} ${row.deck} adaptive top selections: ${top.join('; ')}`);
        }
    }
    const total = report.totals;
    lines.push('', `Total: ${total.adaptiveWins}-${total.legacyWins} (+${total.other}), ` +
        `${(total.adaptiveWinRate * 100).toFixed(1)}% adaptive.`);
    return `${lines.join('\n')}\n`;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        console.log(usage());
        return;
    }
    const rows = [];
    const originalRandom = Math.random;
    try {
        for(let seedIndex = 0; seedIndex < options.seeds.length; seedIndex++) {
            const seed = options.seeds[seedIndex];
            for(let deckIndex = 0; deckIndex < options.decks.length; deckIndex++) {
                const deck = options.decks[deckIndex];
                const loadDeck = getDeckLoader(deck);
                const row = {
                    seed, deck, adaptiveWins: 0, legacyWins: 0, other: 0,
                    adaptiveDecisions: {}, legacyDecisions: {}
                };
                for(let gameIndex = 0; gameIndex < options.games; gameIndex++) {
                    Math.random = seededRandom(
                        options.rngSeed + seedIndex * 1000000 + deckIndex * 10000 + gameIndex
                    );
                    const adaptiveFirst = gameIndex % 2 === 0;
                    let controllers = [];
                    const result = await runGame({
                        names: adaptiveFirst ? ['Adaptive', 'Legacy'] : ['Legacy', 'Adaptive'],
                        seeds: [seed, seed],
                        mulliganPolicies: adaptiveFirst
                            ? ['adaptive', 'legacy']
                            : ['legacy', 'adaptive'],
                        deckA: loadDeck(),
                        deckB: loadDeck(),
                        trace: true,
                        onControllers: (created) => { controllers = created; }
                    });
                    addDecisionStats(
                        row.adaptiveDecisions,
                        controllers[adaptiveFirst ? 0 : 1]
                    );
                    addDecisionStats(
                        row.legacyDecisions,
                        controllers[adaptiveFirst ? 1 : 0]
                    );
                    if(result.winner === 'Adaptive') {
                        row.adaptiveWins++;
                    } else if(result.winner === 'Legacy') {
                        row.legacyWins++;
                    } else {
                        row.other++;
                    }
                    process.stderr.write(`\rseed ${seed} ${deck} ${gameIndex + 1}/${options.games}`);
                }
                row.adaptiveWinRate = row.adaptiveWins /
                    Math.max(1, row.adaptiveWins + row.legacyWins);
                rows.push(row);
            }
        }
    } finally {
        Math.random = originalRandom;
        process.stderr.write('\n');
    }
    const totals = rows.reduce((sum, row) => ({
        adaptiveWins: sum.adaptiveWins + row.adaptiveWins,
        legacyWins: sum.legacyWins + row.legacyWins,
        other: sum.other + row.other
    }), { adaptiveWins: 0, legacyWins: 0, other: 0 });
    totals.adaptiveWinRate = totals.adaptiveWins /
        Math.max(1, totals.adaptiveWins + totals.legacyWins);
    const report = {
        generatedAt: new Date().toISOString(),
        config: options,
        rows,
        totals
    };
    const output = markdown(report);
    console.log(output);
    const prefix = path.resolve(options.out);
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(`${prefix}.md`, output);
    console.log(`Reports: ${prefix}.md`);
}

if(require.main === module) {
    main().catch((error) => {
        console.error(error && error.stack || error);
        process.exit(1);
    });
}

module.exports = { addDecisionStats, markdown, parseArgs, seededRandom, topDecisions };
