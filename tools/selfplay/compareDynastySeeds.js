'use strict';

// Direct seed-4 board-aware dynasty vs seed-1 fate-aware A/B. Both seats use
// the same deck and adaptive shared systems; seats alternate and shuffles are
// deterministic. Each two-game pair reuses the same shuffle stream with seats
// swapped, removing most first-player/deck-order noise. This isolates the
// seed-4 policy without changing standard
// client benchmark results.

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { seededRandom } = require('./compareMulliganPolicies.js');

function usage() {
    return `Usage: node tools/selfplay/compareDynastySeeds.js [options]

Options:
  --games <n>       Games per deck (default 20)
  --decks <csv>     Deck labels (default all)
  --rng-seed <n>    Deterministic base RNG seed (default 20260720)
  --out <prefix>    Report prefix (default tools/selfplay/out/seed4-vs-seed1)
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
        decks: [...DECK_LABELS],
        rngSeed: 20260720,
        out: path.join(__dirname, 'out', 'seed4-vs-seed1'),
        help: false
    };
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
        } else if(arg === '--games') {
            options.games = positiveInteger(argv[++index], arg);
        } else if(arg === '--decks') {
            options.decks = csv(argv[++index]);
        } else if(arg === '--rng-seed') {
            options.rngSeed = positiveInteger(argv[++index], arg);
        } else if(arg === '--out') {
            options.out = argv[++index];
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }
    const unknown = options.decks.filter((label) => !DECK_LABELS.includes(label));
    if(options.decks.length === 0 || unknown.length > 0) {
        throw new Error(`Unknown deck. Valid: ${DECK_LABELS.join(', ')}`);
    }
    return options;
}

function dynastyStats(controller) {
    const reasons = {};
    let additionalFate = 0;
    let purchases = 0;
    for(const entry of controller?.trace || []) {
        const reason = String(entry.reason || '');
        const isDynastyPurchase = entry.command === 'cardClicked' &&
            entry.promptTitle === 'Play cards from provinces';
        const isRelevantReason = /^(board-aware-|fate-aware-)/.test(reason) ||
            /(?:character|tower|setup|important-character)-fate$/.test(reason);
        if(!isDynastyPurchase && !isRelevantReason) {
            continue;
        }
        if(reason) {
            reasons[reason] = (reasons[reason] || 0) + 1;
        }
        if(isDynastyPurchase) {
            purchases++;
        }
        if(/(?:additional-fate|character-fate|tower-fate|setup-fate|important-character-fate)$/.test(reason)) {
            additionalFate += Number(entry.target || entry.args?.[0]) || 0;
        }
    }
    return { reasons, additionalFate, purchases };
}

function mergeStats(total, next) {
    total.additionalFate += next.additionalFate;
    total.purchases += next.purchases;
    for(const [reason, count] of Object.entries(next.reasons)) {
        total.reasons[reason] = (total.reasons[reason] || 0) + count;
    }
}

function markdown(report) {
    const lines = [
        '# Seed 4 board-aware dynasty vs seed 1', '',
        `Games per deck: ${report.config.games}; RNG seed: ${report.config.rngSeed}.`,
        'Same deck and adaptive shared systems; paired shuffle, seats swapped.', '',
        '| Deck | Seed 4 record | Seed 4 win rate | Added fate 4/1 | Purchases 4/1 |',
        '|---|---:|---:|---:|---:|'
    ];
    for(const row of report.rows) {
        lines.push(`| ${row.deck} | ${row.seed4Wins}-${row.seed1Wins} (+${row.other}) | ` +
            `${(row.seed4WinRate * 100).toFixed(1)}% | ` +
            `${row.seed4Stats.additionalFate}/${row.seed1Stats.additionalFate} | ` +
            `${row.seed4Stats.purchases}/${row.seed1Stats.purchases} |`);
    }
    lines.push('', `Total: ${report.totals.seed4Wins}-${report.totals.seed1Wins} (+${report.totals.other}), ` +
        `${(report.totals.seed4WinRate * 100).toFixed(1)}% seed 4.`);
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
            const row = {
                deck, seed4Wins: 0, seed1Wins: 0, other: 0,
                seed4Stats: { reasons: {}, additionalFate: 0, purchases: 0 },
                seed1Stats: { reasons: {}, additionalFate: 0, purchases: 0 }
            };
            for(let gameIndex = 0; gameIndex < options.games; gameIndex++) {
                Math.random = seededRandom(
                    options.rngSeed + deckIndex * 10000 + Math.floor(gameIndex / 2)
                );
                const seed4First = gameIndex % 2 === 0;
                let controllers = [];
                const result = await runGame({
                    names: seed4First ? ['Seed 4', 'Seed 1'] : ['Seed 1', 'Seed 4'],
                    seeds: seed4First ? [4, 1] : [1, 4],
                    deckA: loadDeck(),
                    deckB: loadDeck(),
                    trace: true,
                    onControllers: (created) => { controllers = created; }
                });
                mergeStats(row.seed4Stats, dynastyStats(controllers[seed4First ? 0 : 1]));
                mergeStats(row.seed1Stats, dynastyStats(controllers[seed4First ? 1 : 0]));
                if(result.winner === 'Seed 4') {
                    row.seed4Wins++;
                } else if(result.winner === 'Seed 1') {
                    row.seed1Wins++;
                } else {
                    row.other++;
                }
                process.stderr.write(`\r${deck} ${gameIndex + 1}/${options.games}`);
            }
            row.seed4WinRate = row.seed4Wins / Math.max(1, row.seed4Wins + row.seed1Wins);
            rows.push(row);
        }
    } finally {
        Math.random = originalRandom;
        process.stderr.write('\n');
    }
    const totals = rows.reduce((sum, row) => ({
        seed4Wins: sum.seed4Wins + row.seed4Wins,
        seed1Wins: sum.seed1Wins + row.seed1Wins,
        other: sum.other + row.other
    }), { seed4Wins: 0, seed1Wins: 0, other: 0 });
    totals.seed4WinRate = totals.seed4Wins / Math.max(1, totals.seed4Wins + totals.seed1Wins);
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

module.exports = { dynastyStats, markdown, parseArgs };
