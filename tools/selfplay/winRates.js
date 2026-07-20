'use strict';

// One-stop win-rate board for every piloted bot deck vs Crane Baseline.
// All decks run in parallel, each in its OWN child process (see _deckWorker.js),
// so a rare synchronous engine loop or out-of-memory game kills only that child; the
// parent keeps every game that already streamed and prints the board anyway,
// marking a deck whose child died before finishing. Usage:
//   node tools/selfplay/winRates.js [gamesPerDeck] [botSeed] [craneSeed]
//     [challengerPolicy] [challengerDrawBidPolicy] [craneDrawBidPolicy]
// gamesPerDeck default 100. Seeds: 1 fate-aware (default), 2 old heuristic,
// 3 omniscient, 4 board-aware dynasty. challengerPolicy is an optional
// generic/fate-aware/board-aware challenger override. Challenger and Crane seeds are
// the same by default; craneSeed can override it for direct comparisons.
// A single deck swings ~13pts at N=40, so use higher N for steadier numbers.

const path = require('path');
const { spawn } = require('child_process');
const { DECK_LABELS } = require('./deckRegistry.js');
const {
    STANDARD_GAMES,
    winRatesPayload,
    writeBenchmarkSection
} = require('./standardBenchmark.js');

const BASELINE_DECK = 'Crane';
const DECKS = Object.freeze(DECK_LABELS.filter((label) => label !== BASELINE_DECK));
const WORKER = path.join(__dirname, '_deckWorker.js');

// Per-game wall budget; the deck child is killed if it exceeds games * this.
const PER_GAME_MS = 12000;

function parseBotSeed(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : 1;
}

function parsePolicyOverride(value) {
    return ['generic', 'fate-aware', 'board-aware'].includes(value) ? value : undefined;
}

function parseDrawBidPolicy(value) {
    if(value === undefined || value === '' || value === 'adaptive') {
        return 'adaptive';
    }
    if(value === 'legacy') {
        return 'legacy';
    }
    throw new Error('draw bid policy must be adaptive or legacy');
}

function parseArgs(argv = []) {
    const botSeed = parseBotSeed(argv[1]);
    return {
        games: parseInt(argv[0], 10) || STANDARD_GAMES,
        botSeed,
        craneSeed: argv[2] === undefined ? botSeed : parseBotSeed(argv[2]),
        challengerPolicy: parsePolicyOverride(argv[3]),
        challengerDrawBidPolicy: parseDrawBidPolicy(argv[4]),
        craneDrawBidPolicy: parseDrawBidPolicy(argv[5])
    };
}

function isStandardBenchmarkRun(options, rows) {
    return options.games === STANDARD_GAMES &&
        options.botSeed === options.craneSeed &&
        !options.challengerPolicy &&
        options.challengerDrawBidPolicy === 'adaptive' &&
        options.craneDrawBidPolicy === 'adaptive' &&
        rows.length === DECKS.length &&
        rows.every((row) => !row.died && row.played === STANDARD_GAMES);
}

function seatSeeds(botFirst, botSeed, craneSeed) {
    return botFirst ? [botSeed, craneSeed] : [craneSeed, botSeed];
}

function seedLabel(seed) {
    return ({
        1: 'fate-aware',
        2: 'old heuristic',
        3: 'omniscient',
        4: 'board-aware dynasty'
    })[seed];
}

function runDeckChild(label, games, botSeed, craneSeed, challengerPolicy,
    challengerDrawBidPolicy, craneDrawBidPolicy) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [
            '--max-old-space-size=1024', WORKER, label, String(games), String(botSeed),
            String(craneSeed), challengerPolicy || '',
            challengerDrawBidPolicy, craneDrawBidPolicy
        ], {
            cwd: path.join(__dirname, '..', '..'),
            env: { ...process.env, LOG_LEVEL: 'error' }
        });

        const results = [];
        let buffer = '';
        let killedFor = null;

        const timer = setTimeout(() => {
            killedFor = 'timeout';
            child.kill('SIGKILL');
        }, games * PER_GAME_MS);

        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            let nl;
            while((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if(!line) {
                    continue;
                }
                try {
                    results.push(JSON.parse(line));
                    process.stderr.write('.');
                } catch{
                    /* ignore non-JSON noise */
                }
            }
        });
        // Swallow child stderr (logger noise); a crash is inferred from exit code.
        child.stderr.on('data', () => {});

        child.on('close', (code) => {
            clearTimeout(timer);
            process.stderr.write('\n');
            const died = killedFor || (code !== 0 ? `exit ${code}` : null);
            resolve({ label, results, died: results.length < games ? (died || 'incomplete') : null });
        });
    });
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const {
        games, botSeed, craneSeed, challengerPolicy,
        challengerDrawBidPolicy, craneDrawBidPolicy
    } = options;
    const challengerLabel = challengerPolicy || seedLabel(botSeed);

    process.stderr.write(`running ${DECKS.length} deck simulations in parallel (${games} games each, challenger seed ${botSeed} ${seedLabel(botSeed)} draw ${challengerDrawBidPolicy}, Crane seed ${craneSeed} ${seedLabel(craneSeed)} draw ${craneDrawBidPolicy}${challengerPolicy ? `, challenger override ${challengerPolicy}` : ''})\n`);
    const deckRuns = await Promise.all(DECKS.map((label) =>
        runDeckChild(label, games, botSeed, craneSeed, challengerPolicy,
            challengerDrawBidPolicy, craneDrawBidPolicy)));
    const rows = [];
    for(const { label, results, died } of deckRuns) {
        let wins = 0;
        let losses = 0;
        let other = 0;
        const reasons = {};
        for(const r of results) {
            const key = `${r.winner || 'none'}:${r.reason || 'none'}`;
            reasons[key] = (reasons[key] || 0) + 1;
            if(r.winner === label) {
                wins++;
            } else if(r.winner === BASELINE_DECK) {
                losses++;
            } else {
                other++;
            }
        }
        rows.push({ label, wins, losses, other, played: results.length, reasons, died });
    }

    rows.sort((a, b) => (b.played ? b.wins / b.played : 0) - (a.played ? a.wins / a.played : 0));

    console.log(`\n=== Bot win rates vs Crane Baseline (challenger seed ${botSeed}, ${challengerLabel}, draw ${challengerDrawBidPolicy}; Crane seed ${craneSeed}, ${seedLabel(craneSeed)}, draw ${craneDrawBidPolicy}; N=${games}/deck, seats alternate) ===\n`);
    const deckWidth = Math.max('deck'.length, ...rows.map((row) => row.label.length));
    console.log(`${'deck'.padEnd(deckWidth)}  record     win%   played  top loss / note`);
    console.log(`${'-'.repeat(deckWidth)}  ---------  -----  ------  ------------------------`);
    for(const row of rows) {
        const pct = row.played ? ((row.wins / row.played) * 100).toFixed(0).padStart(3) : ' --';
        const record = `${row.wins}-${row.losses}${row.other ? ' (+' + row.other + ')' : ''}`;
        const craneReasons = Object.entries(row.reasons)
            .filter(([key]) => key.startsWith('Crane:'))
            .sort((a, b) => b[1] - a[1]);
        let note = craneReasons.length > 0 ? `${craneReasons[0][0]} x${craneReasons[0][1]}` : '-';
        if(row.died) {
            note = `child ${row.died} after ${row.played}/${games}`;
        }
        console.log(`${row.label.padEnd(deckWidth)}  ${record.padEnd(9)}  ${pct}%   ${String(row.played).padStart(3)}/${games}  ${note}`);
    }
    console.log('\n(all decks run in parallel in isolated processes; a deck marked "child ..." hit a hang/OOM and shows partial results.)');

    if(isStandardBenchmarkRun(options, rows)) {
        const configPath = writeBenchmarkSection(botSeed, 'winRates', winRatesPayload(options, rows));
        console.log(`Standard client benchmark updated: ${configPath}`);
    } else if(games === STANDARD_GAMES && botSeed === craneSeed && !challengerPolicy &&
        challengerDrawBidPolicy === 'adaptive' && craneDrawBidPolicy === 'adaptive') {
        console.log('Standard client benchmark not updated: run was incomplete.');
    }
}

if(require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    DECKS,
    isStandardBenchmarkRun,
    parseArgs,
    parseBotSeed,
    parseDrawBidPolicy,
    parsePolicyOverride,
    seatSeeds,
    seedLabel
};
