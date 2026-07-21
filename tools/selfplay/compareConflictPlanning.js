'use strict';

// Direct lookahead-vs-legacy conflict-planning A/B. Both seats use the same
// deck and bot seed; seats alternate and each two-game seat pair shares a
// deterministic starting shuffle seed. Reports are diagnostic and never
// update client baselines.

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function usage() {
    return `Usage: node tools/selfplay/compareConflictPlanning.js [options]

Options:
  --games <n>       Games per deck and seed (default 20)
  --seeds <csv>     Bot seeds on both seats (default 1,2,3)
  --decks <csv>     Deck labels (default all)
  --rng-seed <n>    Deterministic base RNG seed (default 20260721)
  --out <prefix>    Report prefix (default tools/selfplay/out/conflict-planning-ab)
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
        rngSeed: 20260721,
        out: path.join(__dirname, 'out', 'conflict-planning-ab'),
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
        if(!/conflict-lookahead/i.test(String(entry.reason || ''))) {
            continue;
        }
        const key = String(entry.reason);
        counts[key] = (counts[key] || 0) + 1;
    }
}

function markdown(report) {
    const lines = [
        '# Conflict-phase lookahead direct A/B', '',
        `Seeds: ${report.config.seeds.join(', ')}; games per deck/seed: ${report.config.games}; RNG seed: ${report.config.rngSeed}`,
        'Lookahead and legacy use the same deck and seed. Seats alternate; each seat pair shares its starting RNG seed.', '',
        '| Seed | Deck | Lookahead record | Lookahead win rate | Planner decisions |',
        '|---:|---|---:|---:|---:|'
    ];
    for(const row of report.rows) {
        const decisions = Object.values(row.lookaheadDecisions).reduce((sum, count) => sum + count, 0);
        lines.push(`| ${row.seed} | ${row.deck} | ${row.lookaheadWins}-${row.legacyWins} (+${row.other}) | ${(row.lookaheadWinRate * 100).toFixed(1)}% | ${decisions} |`);
    }
    const total = report.totals;
    lines.push('', `Total: ${total.lookaheadWins}-${total.legacyWins} (+${total.other}), ` +
        `${(total.lookaheadWinRate * 100).toFixed(1)}% lookahead.`);
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
                    seed, deck, lookaheadWins: 0, legacyWins: 0, other: 0,
                    lookaheadDecisions: {}
                };
                for(let gameIndex = 0; gameIndex < options.games; gameIndex++) {
                    Math.random = seededRandom(
                        options.rngSeed + seedIndex * 1000000 + deckIndex * 10000 + Math.floor(gameIndex / 2)
                    );
                    const lookaheadFirst = gameIndex % 2 === 0;
                    let controllers = [];
                    const result = await runGame({
                        names: lookaheadFirst ? ['Lookahead', 'Legacy'] : ['Legacy', 'Lookahead'],
                        seeds: [seed, seed],
                        conflictPlanningPolicies: lookaheadFirst
                            ? ['lookahead', 'legacy']
                            : ['legacy', 'lookahead'],
                        deckA: loadDeck(),
                        deckB: loadDeck(),
                        trace: true,
                        onControllers: (created) => { controllers = created; }
                    });
                    addDecisionStats(row.lookaheadDecisions, controllers[lookaheadFirst ? 0 : 1]);
                    if(result.winner === 'Lookahead') {
                        row.lookaheadWins++;
                    } else if(result.winner === 'Legacy') {
                        row.legacyWins++;
                    } else {
                        row.other++;
                    }
                    process.stderr.write(`\rseed ${seed} ${deck} ${gameIndex + 1}/${options.games}`);
                }
                row.lookaheadWinRate = row.lookaheadWins /
                    Math.max(1, row.lookaheadWins + row.legacyWins);
                rows.push(row);
            }
        }
    } finally {
        Math.random = originalRandom;
        process.stderr.write('\n');
    }
    const totals = rows.reduce((sum, row) => ({
        lookaheadWins: sum.lookaheadWins + row.lookaheadWins,
        legacyWins: sum.legacyWins + row.legacyWins,
        other: sum.other + row.other
    }), { lookaheadWins: 0, legacyWins: 0, other: 0 });
    totals.lookaheadWinRate = totals.lookaheadWins /
        Math.max(1, totals.lookaheadWins + totals.legacyWins);
    const report = { generatedAt: new Date().toISOString(), config: options, rows, totals };
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

module.exports = { addDecisionStats, markdown, parseArgs, seededRandom };
