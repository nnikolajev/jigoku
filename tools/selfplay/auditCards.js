'use strict';

// Card-utilization audit: runs a bot deck vs the Crane precon and reports,
// for EVERY card in the deck, how often the bot successfully clicked it and
// through which decision reasons. Cards with zero clicks are the interesting
// output — they are either passive (stat sticks, granted reactions handled by
// the engine) or silently blocked by a policy gate (the Softskin/Spyglass
// class of bug). Usage:
//   node tools/selfplay/auditCards.js <unicorn|crab|scorpion|lion|phoenix|dragon|craneduel> [games]

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { buildDeck, loadCraneDeck, FIXTURES } = require('./deckLoader.js');

function loadDeckByName(name) {
    const decklist = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}-decklist.json`), 'utf8'));
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}-cards.json`), 'utf8'));
    // Fixtures are either an array of cards or an id -> card map.
    const cardsArray = Array.isArray(raw) ? raw : Object.values(raw);
    const cardsById = {};
    for(const card of cardsArray) {
        cardsById[card.id] = card;
    }
    return { deck: buildDeck(decklist, cardsById), decklist, cardsArray };
}

async function main() {
    const deckName = process.argv[2];
    const games = parseInt(process.argv[3], 10) || 20;
    if(!['unicorn', 'crab', 'scorpion', 'lion', 'phoenix', 'dragon', 'craneduel'].includes(deckName)) {
        console.error('usage: node tools/selfplay/auditCards.js <unicorn|crab|scorpion|lion|phoenix|dragon|craneduel> [games]');
        process.exit(1);
    }

    const { decklist, cardsArray } = loadDeckByName(deckName);
    const botLabel = deckName[0].toUpperCase() + deckName.slice(1);

    // name -> { total, reasons: { reason: count } } from successful decisions.
    const usage = {};
    let wins = 0;
    let losses = 0;

    for(let i = 0; i < games; i++) {
        const botFirst = i % 2 === 0;
        const names = botFirst ? [botLabel, 'Crane'] : ['Crane', botLabel];
        const seeds = [1, 1];
        const { deck } = loadDeckByName(deckName);
        const decks = botFirst
            ? { deckA: deck, deckB: loadCraneDeck() }
            : { deckA: loadCraneDeck(), deckB: deck };

        let controllers = null;
        const result = await runGame({
            names,
            seeds,
            ...decks,
            trace: true,
            onControllers: (list) => {
                controllers = list;
            }
        });

        if(result.winner === botLabel) {
            wins++;
        } else if(result.winner === 'Crane') {
            losses++;
        }

        if(controllers) {
            const botController = controllers[botFirst ? 0 : 1];
            for(const entry of botController.trace || []) {
                if(entry.result !== 'success' || !entry.target || entry.command !== 'cardClicked') {
                    continue;
                }
                const record = usage[entry.target] || (usage[entry.target] = { total: 0, reasons: {} });
                record.total++;
                record.reasons[entry.reason] = (record.reasons[entry.reason] || 0) + 1;
            }
        }
        process.stdout.write(`game ${i + 1}/${games}: winner=${result.winner} reason=${result.winReason}\n`);
    }

    console.log(`\n${botLabel} ${wins} - ${losses} Crane (N=${games})\n`);
    console.log('=== per-card successful clicks (deck order) ===');
    const zero = [];
    for(const id of Object.keys(decklist.cards)) {
        const card = cardsArray.find((c) => c.id === id);
        const name = card ? card.name : id;
        const record = usage[name];
        if(!record) {
            zero.push(`${id} (${card ? card.type + '/' + (card.side || '') : '?'})`);
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
