'use strict';

// Focused conflict-policy audit. Runs real headless games and reports whether
// each target bot attacks when a safe/final opportunity exists, declares
// defenders, and spends cards while its stronghold province is under attack.
//
// Usage:
//   node tools/selfplay/auditConflictBehavior.js
//   node tools/selfplay/auditConflictBehavior.js --games 10 --seed 3
//   node tools/selfplay/auditConflictBehavior.js --decks Dragon,Lion --opponent Crane

const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function parseArgs(argv) {
    const options = {
        games: 5,
        seed: 1,
        opponent: 'Crane',
        opponentSeed: null,
        decks: [...DECK_LABELS],
        rngSeed: 20260717
    };
    const valueFlags = new Map([
        ['--games', 'games'],
        ['--seed', 'seed'],
        ['--opponent', 'opponent'],
        ['--opponent-seed', 'opponentSeed'],
        ['--decks', 'decks'],
        ['--rng-seed', 'rngSeed']
    ]);
    const numeric = new Set(['games', 'seed', 'opponentSeed', 'rngSeed']);

    for(let i = 0; i < argv.length; i++) {
        const key = valueFlags.get(argv[i]);
        if(!key || i + 1 >= argv.length) {
            throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
        }
        const raw = argv[++i];
        options[key] = key === 'decks'
            ? raw.split(',').map((value) => value.trim()).filter(Boolean)
            : numeric.has(key) ? Number(raw) : raw;
    }

    if(!Number.isInteger(options.games) || options.games < 1) {
        throw new Error('--games must be a positive integer');
    }
    if(!Number.isInteger(options.seed) || options.seed < 1 || options.seed > 3) {
        throw new Error('--seed must be 1..3');
    }
    if(options.opponentSeed === null) {
        options.opponentSeed = options.seed;
    }
    if(!Number.isInteger(options.opponentSeed) || options.opponentSeed < 1 || options.opponentSeed > 3) {
        throw new Error('--opponent-seed must be 1..3');
    }
    for(const label of [...options.decks, options.opponent]) {
        if(!getDeckLoader(label)) {
            throw new Error(`Unknown deck '${label}'. Valid: ${DECK_LABELS.join(', ')}`);
        }
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

function skill(card, axis) {
    const summary = axis === 'political' ? card?.politicalSkillSummary : card?.militarySkillSummary;
    const value = Number(summary?.stat);
    return Number.isFinite(value) ? value : 0;
}

function playerSnapshot(game, playerName, opponentName) {
    const state = game.getState(playerName);
    const me = state?.players?.[playerName] || {};
    const opponent = state?.players?.[opponentName] || {};
    const mine = (me?.cardPiles?.cardsInPlay || []).filter((card) => card.type === 'character');
    const theirs = (opponent?.cardPiles?.cardsInPlay || []).filter((card) => card.type === 'character');
    const militaryRemaining = Number(me?.stats?.militaryRemaining) || 0;
    const politicalRemaining = Number(me?.stats?.politicalRemaining) || 0;
    const readyAttackers = mine.filter((card) => !card.bowed && (
        (militaryRemaining > 0 && skill(card, 'military') > 0) ||
        (politicalRemaining > 0 && skill(card, 'political') > 0)
    ));
    const strongholdUnderAttack = (me?.strongholdProvince || [])
        .some((card) => card.isProvince && card.inConflict && !card.isBroken);

    return {
        round: Number(game.roundNumber) || 0,
        fate: Number(me?.stats?.fate) || 0,
        conflictsRemaining: Number(me?.stats?.conflictsRemaining) || 0,
        opponentConflictsRemaining: Number(opponent?.stats?.conflictsRemaining) || 0,
        readyAttackers: readyAttackers.length,
        opponentReady: theirs.filter((card) => !card.bowed).length,
        participants: mine.filter((card) => card.inConflict).length,
        strongholdUnderAttack
    };
}

function instrument(controller, game, playerName, opponentName) {
    const events = [];
    let before = null;
    const runCommand = controller.runCommand.bind(controller);
    controller.runCommand = (command, name, args) => {
        before = playerSnapshot(game, playerName, opponentName);
        return runCommand(command, name, args);
    };
    const record = controller.record.bind(controller);
    controller.record = (prompt, decision, result, reason) => {
        record(prompt, decision, result, reason);
        events.push({
            promptTitle: prompt?.promptTitle || '',
            menuTitle: prompt?.menuTitle || '',
            command: decision?.command || '',
            target: decision?.target || '',
            reason: reason || decision?.reason || '',
            result,
            before: before || playerSnapshot(game, playerName, opponentName)
        });
        before = null;
    };
    return events;
}

function emptyRow(deck) {
    return {
        deck,
        games: 0,
        attacks: 0,
        passes: 0,
        suspiciousPasses: 0,
        normalDefended: 0,
        normalUndefended: 0,
        strongholdDefended: 0,
        strongholdUndefended: 0,
        strongholdCardPlays: 0,
        strongholdUsefulCards: 0,
        concessionReasons: {},
        suspiciousSamples: []
    };
}

function addGame(row, events) {
    row.games++;
    for(const event of events) {
        if(event.result !== 'success') {
            continue;
        }
        if(event.reason === 'initiate-conflict') {
            row.attacks++;
        }
        const declarationPrompt = event.promptTitle === 'Initiate Conflict' ||
            /do you wish to declare a conflict/i.test(event.menuTitle);
        const conflictPass = declarationPrompt && event.command === 'menuButton' &&
            /pass conflict/i.test(event.target);
        if(conflictPass) {
            row.passes++;
            const safe = event.before.readyAttackers > 0 && (
                event.before.opponentReady === 0 || event.before.opponentConflictsRemaining === 0);
            if(safe) {
                row.suspiciousPasses++;
                if(row.suspiciousSamples.length < 5) {
                    row.suspiciousSamples.push({ reason: event.reason, ...event.before });
                }
            }
        }

        const defenderDone = /Conflict:\s*-?\d+\s+vs\s+-?\d+/i.test(event.promptTitle) &&
            /choose defenders/i.test(event.menuTitle) && event.command === 'menuButton';
        if(defenderDone) {
            const defended = event.before.participants > 0;
            if(event.before.strongholdUnderAttack) {
                row[defended ? 'strongholdDefended' : 'strongholdUndefended']++;
            } else {
                row[defended ? 'normalDefended' : 'normalUndefended']++;
            }
            if(!defended) {
                row.concessionReasons[event.reason] = (row.concessionReasons[event.reason] || 0) + 1;
            }
        }

        if(event.before.strongholdUnderAttack && event.promptTitle === 'Conflict Action Window' &&
            event.reason === 'play-conflict-card') {
            row.strongholdCardPlays++;
            if(event.target === 'Swell of Seafoam' || event.target === 'Iron Foundations Stance') {
                row.strongholdUsefulCards++;
            }
        }
    }
}

function pad(value, width) {
    return String(value).padEnd(width);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const originalRandom = Math.random;
    const rows = [];

    try {
        for(const [deckIndex, deck] of options.decks.entries()) {
            const row = emptyRow(deck);
            for(let gameIndex = 0; gameIndex < options.games; gameIndex++) {
                Math.random = seededRandom(options.rngSeed + deckIndex * 1000 + gameIndex);
                const targetFirst = gameIndex % 2 === 0;
                const targetName = `Target-${deck}`;
                const opponentName = `Opponent-${options.opponent}`;
                const names = targetFirst ? [targetName, opponentName] : [opponentName, targetName];
                const seeds = targetFirst
                    ? [options.seed, options.opponentSeed]
                    : [options.opponentSeed, options.seed];
                const decks = targetFirst
                    ? { deckA: getDeckLoader(deck)(), deckB: getDeckLoader(options.opponent)() }
                    : { deckA: getDeckLoader(options.opponent)(), deckB: getDeckLoader(deck)() };
                let targetEvents = [];
                await runGame({
                    names,
                    seeds,
                    ...decks,
                    trace: true,
                    onControllers: (controllers) => {
                        const targetIndex = names.indexOf(targetName);
                        targetEvents = instrument(
                            controllers[targetIndex],
                            controllers[targetIndex].game,
                            targetName,
                            opponentName
                        );
                    }
                });
                addGame(row, targetEvents);
            }
            rows.push(row);
        }
    } finally {
        Math.random = originalRandom;
    }

    console.log(`Conflict behavior audit (N=${options.games}/deck, seed ${options.seed}, opponent ${options.opponent} seed ${options.opponentSeed})`);
    console.log(`${pad('deck', 20)}${pad('attack', 9)}${pad('pass', 8)}${pad('sus', 7)}${pad('normal def', 13)}${pad('SH def', 11)}${pad('SH cards', 10)}SH kiho`);
    console.log('-'.repeat(87));
    for(const row of rows) {
        const normal = `${row.normalDefended}/${row.normalDefended + row.normalUndefended}`;
        const stronghold = `${row.strongholdDefended}/${row.strongholdDefended + row.strongholdUndefended}`;
        console.log(`${pad(row.deck, 20)}${pad(row.attacks, 9)}${pad(row.passes, 8)}${pad(row.suspiciousPasses, 7)}${pad(normal, 13)}${pad(stronghold, 11)}${pad(row.strongholdCardPlays, 10)}${row.strongholdUsefulCards}`);
        if(row.suspiciousSamples.length > 0) {
            console.log(`  suspicious: ${JSON.stringify(row.suspiciousSamples)}`);
        }
        if(Object.keys(row.concessionReasons).length > 0) {
            console.log(`  undefended: ${JSON.stringify(row.concessionReasons)}`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
