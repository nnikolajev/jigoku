'use strict';

// Cross-pool round robin, with an optional same-deck mirror gate. Seats
// alternate and paired games reuse deterministic shuffle streams. This
// isolates hidden-information value without turning it into a policy seed.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DECK_LABELS } = require('./deckRegistry.js');
const {
    STANDARD_OMNISCIENT_GAMES,
    omniscientPayload,
    writeBenchmarkSection
} = require('./standardBenchmark.js');

const WORKER = path.join(__dirname, '_omniscientRoundRobinWorker.js');
const DEFAULT_CHUNK_SIZE = 10;
const DEFAULT_RNG_SEED = 20260721;
const PER_GAME_MS = 12000;

function usage() {
    return `Usage: node tools/selfplay/botOmniscientRoundRobin.js [seed] [options]

Every omniscient deck plays every default deck on the same seed.

Options:
  --seed <1|2|3>       Strategy seed (positional seed also accepted; default 1)
  --games <n>          Games per ordered matchup (default ${STANDARD_OMNISCIENT_GAMES})
  --workers <n>        Parallel workers (default 32)
  --chunk-size <n>     Games per isolated job (default ${DEFAULT_CHUNK_SIZE})
  --rng-seed <n>       Deterministic base RNG seed (default ${DEFAULT_RNG_SEED})
  --decks <csv>        Omniscient decks under test (default all)
  --opponents <csv>    Default opponent decks (default all)
  --mirrors-only       Test each selected deck only against its normal mirror
  --trace              Record successful decision-reason histograms
  --out <prefix>       Report path prefix
  --help               Show help`;
}

function positiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if(!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

function parseDecks(value, flag) {
    const decks = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    const unknown = decks.filter((deck) => !DECK_LABELS.includes(deck));
    if(decks.length === 0 || unknown.length > 0) {
        throw new Error(`${flag} contains unknown deck(s): ${unknown.join(', ') || '(empty)'}`);
    }
    return [...new Set(decks)];
}

function parseArgs(argv) {
    const positionalSeed = argv[0] && !String(argv[0]).startsWith('--')
        ? positiveInteger(argv[0], 'seed')
        : 1;
    const options = {
        seed: positionalSeed,
        games: STANDARD_OMNISCIENT_GAMES,
        workers: 32,
        chunkSize: DEFAULT_CHUNK_SIZE,
        rngSeed: DEFAULT_RNG_SEED,
        decks: [...DECK_LABELS],
        opponents: [...DECK_LABELS],
        mirrorsOnly: false,
        trace: false,
        outPrefix: path.join(__dirname, 'out', `omniscient-round-robin-seed${positionalSeed}`),
        help: false
    };
    for(let index = positionalSeed !== 1 || argv[0] === '1' ? 1 : 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
        } else if(arg === '--mirrors-only') {
            options.mirrorsOnly = true;
        } else if(arg === '--trace') {
            options.trace = true;
        } else if(arg === '--seed') {
            options.seed = positiveInteger(argv[++index], arg);
        } else if(arg === '--games') {
            options.games = positiveInteger(argv[++index], arg);
        } else if(arg === '--workers') {
            options.workers = positiveInteger(argv[++index], arg);
        } else if(arg === '--chunk-size') {
            options.chunkSize = positiveInteger(argv[++index], arg);
        } else if(arg === '--rng-seed') {
            options.rngSeed = positiveInteger(argv[++index], arg);
        } else if(arg === '--decks') {
            options.decks = parseDecks(argv[++index], arg);
        } else if(arg === '--opponents') {
            options.opponents = parseDecks(argv[++index], arg);
        } else if(arg === '--out') {
            options.outPrefix = path.resolve(argv[++index]);
        } else {
            throw new Error(`unknown option: ${arg}`);
        }
    }
    if(options.seed > 3) {
        throw new Error('seed must be 1, 2, or 3');
    }
    options.workers = Math.min(options.workers, 32);
    options.chunkSize = Math.min(options.chunkSize, options.games);
    if(!argv.includes('--out')) {
        options.outPrefix = path.join(__dirname, 'out', `omniscient-round-robin-seed${options.seed}`);
    }
    return options;
}

function buildJobs(options) {
    const jobs = [];
    let matchupOrdinal = 0;
    for(const deck of options.decks) {
        const opponents = options.mirrorsOnly
            ? options.opponents.filter((opponent) => opponent === deck)
            : options.opponents;
        for(const opponent of opponents) {
            const matchupRngSeed = options.rngSeed + matchupOrdinal * 100000;
            matchupOrdinal++;
            for(let startIndex = 0; startIndex < options.games; startIndex += options.chunkSize) {
                jobs.push({
                    deck,
                    opponent,
                    startIndex,
                    games: Math.min(options.chunkSize, options.games - startIndex),
                    rngSeed: matchupRngSeed
                });
            }
        }
    }
    return jobs;
}

function parseJsonLines(text, results) {
    let remaining = text;
    let newline;
    while((newline = remaining.indexOf('\n')) >= 0) {
        const line = remaining.slice(0, newline).trim();
        remaining = remaining.slice(newline + 1);
        if(line) {
            try {
                results.push(JSON.parse(line));
            } catch{
                // Ignore logger noise.
            }
        }
    }
    return remaining;
}

function runJob(job, seed, trace = false) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [
            '--max-old-space-size=1024', WORKER, job.deck, job.opponent,
            String(job.games), String(seed), String(job.startIndex), String(job.rngSeed), trace ? 'trace' : 'no-trace'
        ], {
            cwd: path.join(__dirname, '..', '..'),
            env: { ...process.env, LOG_LEVEL: 'error' }
        });
        const results = [];
        let stdout = '';
        let stderr = '';
        let killedFor = null;
        const timer = setTimeout(() => {
            killedFor = 'timeout';
            child.kill('SIGKILL');
        }, job.games * PER_GAME_MS + 5000);
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
            stdout = parseJsonLines(stdout, results);
        });
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk.toString()).slice(-2000);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            parseJsonLines(`${stdout}\n`, results);
            const died = results.length < job.games
                ? (killedFor || (code !== 0 ? `exit ${code}` : 'incomplete'))
                : null;
            resolve({ ...job, results, died, error: died ? stderr.trim() || null : null });
        });
    });
}

async function runPool(jobs, workers, run, onComplete) {
    let next = 0;
    async function consume() {
        while(next < jobs.length) {
            const index = next++;
            const result = await run(jobs[index]);
            onComplete(result, index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, consume));
}

function summarize(options, jobResults) {
    const map = new Map(options.decks.map((deck) => [deck, {
        deck, wins: 0, losses: 0, other: 0, played: 0, failedJobs: [], opponents: {},
        omniscientTrace: {}, defaultTrace: {}, winReasons: {}
    }]));
    const defaults = new Map(options.opponents.map((deck) => [deck, {
        deck, wins: 0, losses: 0, other: 0, played: 0
    }]));
    for(const job of jobResults) {
        const row = map.get(job.deck);
        const opponent = row.opponents[job.opponent] || (row.opponents[job.opponent] = {
            wins: 0, losses: 0, other: 0, played: 0
        });
        const defaultRow = defaults.get(job.opponent);
        for(const result of job.results) {
            row.played++;
            opponent.played++;
            if(defaultRow) {
                defaultRow.played++;
            }
            if(result.winner === 'omniscient') {
                row.wins++;
                opponent.wins++;
                if(defaultRow) {
                    defaultRow.losses++;
                }
            } else if(result.winner === 'default') {
                row.losses++;
                opponent.losses++;
                if(defaultRow) {
                    defaultRow.wins++;
                }
            } else {
                row.other++;
                opponent.other++;
                if(defaultRow) {
                    defaultRow.other++;
                }
            }
            const reasonKey = `${result.winner || 'other'}:${result.reason || 'unknown'}`;
            row.winReasons[reasonKey] = (row.winReasons[reasonKey] || 0) + 1;
            for(const [reason, count] of Object.entries(result.omniscientTrace || {})) {
                row.omniscientTrace[reason] = (row.omniscientTrace[reason] || 0) + count;
            }
            for(const [reason, count] of Object.entries(result.defaultTrace || {})) {
                row.defaultTrace[reason] = (row.defaultTrace[reason] || 0) + count;
            }
        }
        if(job.died) {
            row.failedJobs.push({ opponent: job.opponent, startIndex: job.startIndex, cause: job.died, error: job.error });
        }
    }
    const deckSummaries = [...map.values()].map((row) => {
        const resolved = row.wins + row.losses;
        const defaultRow = defaults.get(row.deck);
        const defaultResolved = defaultRow ? defaultRow.wins + defaultRow.losses : 0;
        const mirror = row.opponents[row.deck];
        const mirrorResolved = mirror ? mirror.wins + mirror.losses : 0;
        const winRate = resolved > 0 ? row.wins / resolved : null;
        const defaultWinRate = defaultResolved > 0 ? defaultRow.wins / defaultResolved : null;
        return {
            ...row,
            winRate,
            defaultPool: defaultRow ? { ...defaultRow, winRate: defaultWinRate } : null,
            uplift: winRate !== null && defaultWinRate !== null ? winRate - defaultWinRate : null,
            mirror: mirror ? { ...mirror, winRate: mirrorResolved > 0 ? mirror.wins / mirrorResolved : null } : null
        };
    }).sort((left, right) => (right.uplift ?? -2) - (left.uplift ?? -2));
    const totals = deckSummaries.reduce((sum, row) => ({
        wins: sum.wins + row.wins,
        losses: sum.losses + row.losses,
        other: sum.other + row.other,
        played: sum.played + row.played
    }), { wins: 0, losses: 0, other: 0, played: 0 });
    totals.winRate = totals.wins + totals.losses > 0 ? totals.wins / (totals.wins + totals.losses) : null;
    return { deckSummaries, totals };
}

function percent(rate) {
    return rate === null ? '--' : `${(rate * 100).toFixed(1)}%`;
}

function renderMarkdown(report) {
    const expectedPerDeck = report.config.mirrorsOnly
        ? report.config.games
        : report.config.games * report.config.opponents.length;
    const lines = [
        `# Omniscient capability ${report.config.mirrorsOnly ? 'mirror gate' : 'round robin'}`, '',
        `Seed: ${report.config.seed}; games per ordered matchup: ${report.config.games}; RNG seed: ${report.config.rngSeed}.`,
        report.config.mirrorsOnly
            ? 'Each omniscient deck plays its normal mirror. Strategy seed, deck, and adaptive shared systems are identical; seats alternate.'
            : 'Every omniscient deck plays every default deck. Strategy seed and adaptive shared systems are identical; seats alternate.', '',
        '| Deck | Omniscient pool | Normal pool | Uplift | Same-deck mirror | 60% gate | Completed |',
        '|---|---:|---:|---:|---:|:---:|---:|'
    ];
    for(const row of report.deckSummaries) {
        const normal = row.defaultPool;
        const mirror = row.mirror;
        lines.push(`| ${row.deck} | ${row.wins}-${row.losses} (${percent(row.winRate)}) | ` +
            `${normal ? `${normal.wins}-${normal.losses} (${percent(normal.winRate)})` : '--'} | ${percent(row.uplift)} | ` +
            `${mirror ? `${mirror.wins}-${mirror.losses} (${percent(mirror.winRate)})` : '--'} | ` +
            `${mirror && mirror.winRate >= 0.6 ? 'PASS' : 'FAIL'} | ` +
            `${row.played}/${expectedPerDeck} |`);
    }
    lines.push('', `Total: ${report.totals.wins}-${report.totals.losses} (+${report.totals.other}), ${percent(report.totals.winRate)} omniscient.`, '');
    return lines.join('\n');
}

function isStandardRun(options, report) {
    const all = (values) => values.length === DECK_LABELS.length && DECK_LABELS.every((deck) => values.includes(deck));
    return options.games === STANDARD_OMNISCIENT_GAMES &&
        !options.mirrorsOnly && !options.trace &&
        options.rngSeed === DEFAULT_RNG_SEED && all(options.decks) && all(options.opponents) &&
        report.deckSummaries.every((row) => row.failedJobs.length === 0 &&
            row.played === STANDARD_OMNISCIENT_GAMES * DECK_LABELS.length);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        console.log(usage());
        return;
    }
    const jobs = buildJobs(options);
    const results = new Array(jobs.length);
    let completedJobs = 0;
    let completedGames = 0;
    const totalGames = jobs.reduce((total, job) => total + job.games, 0);
    process.stderr.write(`omniscient round robin seed ${options.seed}: ${totalGames} games, ${options.workers} workers\n`);
    await runPool(jobs, options.workers, (job) => runJob(job, options.seed, options.trace), (result, index) => {
        results[index] = result;
        completedJobs++;
        completedGames += result.results.length;
        process.stderr.write(`\rjobs ${completedJobs}/${jobs.length}; games ${completedGames}/${totalGames}`);
    });
    process.stderr.write('\n');
    const report = {
        generatedAt: new Date().toISOString(),
        config: {
            seed: options.seed,
            games: options.games,
            workers: options.workers,
            chunkSize: options.chunkSize,
            rngSeed: options.rngSeed,
            decks: options.decks,
            opponents: options.opponents,
            mirrorsOnly: options.mirrorsOnly,
            trace: options.trace
        },
        ...summarize(options, results)
    };
    const prefix = path.resolve(options.outPrefix);
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(`${prefix}.md`, renderMarkdown(report));
    console.log(renderMarkdown(report));
    console.log(`Reports: ${prefix}.md\n         ${prefix}.json`);
    if(isStandardRun(options, report)) {
        const configPath = writeBenchmarkSection(options.seed, 'omniscient', omniscientPayload(report));
        console.log(`Standard client benchmark updated: ${configPath}`);
    }
}

if(require.main === module) {
    main().catch((error) => {
        console.error(error && error.stack || error);
        process.exit(1);
    });
}

module.exports = { buildJobs, isStandardRun, parseArgs, renderMarkdown, summarize };
