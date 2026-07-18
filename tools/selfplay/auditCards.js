'use strict';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

// Reusable card-utilization audit. Runs any registered bot deck, records every
// successful card click (play or printed/granted ability), and lists cards that
// never became active. Zero-click characters/provinces may be passive; zero-
// click events and actionable cards are policy/reachability candidates.
//
// Usage:
//   node tools/selfplay/auditCards.js <deck> [games=20] [seed=1] [opponent=Crane]
// Examples:
//   node tools/selfplay/auditCards.js Crane 100 1 PhoenixShugenja
//   node tools/selfplay/auditCards.js dragon-attachments 40 5 Crane

const { runGame } = require('./harness.js');
const { DECK_LABELS, DECK_LOADERS } = require('./deckRegistry.js');

const ALIASES = Object.freeze({
    crane: 'Crane',
    'crane-baseline': 'Crane',
    craneduel: 'CraneDuels',
    'crane-duels': 'CraneDuels',
    crab: 'Crab',
    dragon: 'Dragon',
    'dragon-attachments': 'DragonAttachments',
    dragonattachments: 'DragonAttachments',
    lion: 'Lion',
    phoenix: 'Phoenix',
    'phoenix-shugenja': 'PhoenixShugenja',
    phoenixshugenja: 'PhoenixShugenja',
    scorpion: 'Scorpion',
    unicorn: 'Unicorn'
});

function deckLabel(value) {
    if(!value) {
        return undefined;
    }
    return DECK_LABELS.find((label) => label.toLowerCase() === String(value).toLowerCase()) ||
        ALIASES[String(value).toLowerCase()];
}

function deckEntries(deck) {
    return [
        ...(deck.stronghold || []),
        ...(deck.role || []),
        ...(deck.provinceCards || []),
        ...(deck.dynastyCards || []),
        ...(deck.conflictCards || [])
    ];
}

async function main() {
    const subject = deckLabel(process.argv[2]);
    const games = Math.max(1, parseInt(process.argv[3], 10) || 20);
    const seed = parseInt(process.argv[4], 10) || 1;
    const opponent = deckLabel(process.argv[5]) || (subject === 'Crane' ? 'PhoenixShugenja' : 'Crane');
    if(!subject || !opponent) {
        console.error(`usage: node tools/selfplay/auditCards.js <${DECK_LABELS.join('|')}> [games=20] [seed=1] [opponent=Crane]`);
        process.exit(1);
    }

    const subjectTemplate = DECK_LOADERS[subject]();
    const entries = deckEntries(subjectTemplate);
    const cards = new Map(entries.map((entry) => [entry.card.id, entry.card]));
    const usage = {};
    let wins = 0;
    let losses = 0;

    for(let i = 0; i < games; i++) {
        const botFirst = i % 2 === 0;
        const names = botFirst ? [subject, opponent] : [opponent, subject];
        const decks = botFirst
            ? { deckA: DECK_LOADERS[subject](), deckB: DECK_LOADERS[opponent]() }
            : { deckA: DECK_LOADERS[opponent](), deckB: DECK_LOADERS[subject]() };
        let controllers = null;
        const result = await runGame({
            names,
            seeds: [seed, seed],
            ...decks,
            trace: true,
            onControllers: (list) => {
                controllers = list;
            }
        });

        if(result.winner === subject) {
            wins++;
        } else if(result.winner === opponent) {
            losses++;
        }
        const botController = controllers?.[botFirst ? 0 : 1];
        for(const trace of botController?.trace || []) {
            if(trace.result !== 'success' || trace.command !== 'cardClicked' || !trace.target) {
                continue;
            }
            const record = usage[trace.target] || (usage[trace.target] = { total: 0, reasons: {} });
            record.total++;
            record.reasons[trace.reason] = (record.reasons[trace.reason] || 0) + 1;
        }
        process.stdout.write(`game ${i + 1}/${games}: winner=${result.winner} reason=${result.winReason}\n`);
    }

    console.log(`\n${subject} ${wins} - ${losses} ${opponent} (N=${games}, seed=${seed})\n`);
    console.log('=== per-card successful clicks (deck order) ===');
    const zero = [];
    for(const [id, card] of cards) {
        const record = usage[card.name];
        if(!record) {
            zero.push(`${id} (${card.type}/${card.side || ''})`);
            continue;
        }
        const reasons = Object.entries(record.reasons)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => `${reason}:${count}`)
            .join(', ');
        console.log(`  ${String(record.total).padStart(4)}  ${id}  [${reasons}]`);
    }
    console.log('\n=== ZERO clicks ===');
    for(const line of zero) {
        console.log(`  ${line}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
