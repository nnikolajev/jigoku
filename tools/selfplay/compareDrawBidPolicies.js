'use strict';

// Direct adaptive-vs-legacy draw-policy A/B. Both seats use the same deck and
// bot seed; seats alternate and every game gets a deterministic shuffle seed.
// This isolates draw bidding from deck matchup strength and never updates the
// standardized client benchmark JSON.

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function usage() {
    return `Usage: node tools/selfplay/compareDrawBidPolicies.js [options]

Options:
  --games <n>       Games per deck (default 40)
  --seed <1..5>     Bot seed on both seats (default 1)
  --decks <csv>     Deck labels (default all)
  --rng-seed <n>    Deterministic base RNG seed (default 20260719)
  --out <prefix>    Report prefix (default tools/selfplay/out/draw-bid-ab)
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

function parseArgs(argv) {
    const options = {
        games: 40,
        seed: 1,
        decks: [...DECK_LABELS],
        rngSeed: 20260719,
        out: path.join(__dirname, 'out', 'draw-bid-ab'),
        help: false
    };
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
        } else if(arg === '--games') {
            options.games = positiveInteger(argv[++index], arg);
        } else if(arg === '--seed') {
            options.seed = positiveInteger(argv[++index], arg);
        } else if(arg === '--rng-seed') {
            options.rngSeed = positiveInteger(argv[++index], arg);
        } else if(arg === '--decks') {
            options.decks = String(argv[++index] || '').split(',')
                .map((label) => label.trim()).filter(Boolean);
        } else if(arg === '--out') {
            options.out = argv[++index];
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }
    if(options.seed > 5) {
        throw new Error('--seed must be 1..5');
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

function markdown(report) {
    const lines = [
        '# Draw-bid policy direct A/B', '',
        `Bot seed: ${report.config.seed}; games per deck: ${report.config.games}; RNG seed: ${report.config.rngSeed}`,
        'Adaptive and legacy use the same deck. Seats alternate.', '',
        '| Deck | Adaptive record | Adaptive win rate |',
        '|---|---:|---:|'
    ];
    for(const row of report.decks) {
        lines.push(`| ${row.deck} | ${row.adaptiveWins}-${row.legacyWins} (+${row.other}) | ${(row.adaptiveWinRate * 100).toFixed(1)}% |`);
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
        for(let deckIndex = 0; deckIndex < options.decks.length; deckIndex++) {
            const deck = options.decks[deckIndex];
            const loadDeck = getDeckLoader(deck);
            const row = { deck, adaptiveWins: 0, legacyWins: 0, other: 0 };
            for(let gameIndex = 0; gameIndex < options.games; gameIndex++) {
                Math.random = seededRandom(options.rngSeed + deckIndex * 10000 + gameIndex);
                const adaptiveFirst = gameIndex % 2 === 0;
                const names = adaptiveFirst
                    ? ['Adaptive', 'Legacy']
                    : ['Legacy', 'Adaptive'];
                const result = await runGame({
                    names,
                    seeds: [options.seed, options.seed],
                    drawBidPolicies: adaptiveFirst
                        ? ['adaptive', 'legacy']
                        : ['legacy', 'adaptive'],
                    deckA: loadDeck(),
                    deckB: loadDeck(),
                    trace: false
                });
                if(result.winner === 'Adaptive') {
                    row.adaptiveWins++;
                } else if(result.winner === 'Legacy') {
                    row.legacyWins++;
                } else {
                    row.other++;
                }
                process.stderr.write(`\r${deck} ${gameIndex + 1}/${options.games}`);
            }
            row.adaptiveWinRate = row.adaptiveWins /
                Math.max(1, row.adaptiveWins + row.legacyWins);
            rows.push(row);
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
        decks: rows,
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

module.exports = { markdown, parseArgs, seededRandom };
