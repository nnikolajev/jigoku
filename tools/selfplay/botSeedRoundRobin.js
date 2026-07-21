'use strict';

// Cross-pool strategy-seed benchmark. Every subject deck plays every opponent
// deck for each selected opponent seed. Seats alternate and paired games reuse
// deterministic shuffle streams, isolating strategy changes from seat/deck RNG.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DECK_LABELS } = require('./deckRegistry.js');

const WORKER = path.join(__dirname, '_seedRoundRobinWorker.js');
const DEFAULT_GAMES = 20;
const DEFAULT_CHUNK_SIZE = 10;
const DEFAULT_RNG_SEED = 20260721;
const PER_GAME_MS = 12000;

function usage() {
    return `Usage: node tools/selfplay/botSeedRoundRobin.js [options]

Every subject-seed deck plays every selected deck on each opponent seed.

Options:
  --subject-seed <1|2|3>    Seed under test (default 3)
  --opponent-seeds <csv>    Comparison seeds (default 1,2)
  --games <n>               Games per ordered deck/seed matchup (default ${DEFAULT_GAMES})
  --workers <n>             Parallel workers (default 32)
  --chunk-size <n>          Games per isolated job (default ${DEFAULT_CHUNK_SIZE})
  --rng-seed <n>            Deterministic base RNG seed (default ${DEFAULT_RNG_SEED})
  --decks <csv>             Subject decks (default all)
  --opponents <csv>         Opponent decks (default all)
  --trace                   Record successful decision-reason histograms
  --out <prefix>            Report path prefix
  --help                    Show help`;
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

function parseSeeds(value, flag) {
    const seeds = String(value || '').split(',').map((item) => positiveInteger(item.trim(), flag));
    if(seeds.length === 0 || seeds.some((seed) => seed > 3)) {
        throw new Error(`${flag} must contain seeds 1, 2, or 3`);
    }
    return [...new Set(seeds)];
}

function parseArgs(argv) {
    const options = {
        subjectSeed: 3,
        opponentSeeds: [1, 2],
        games: DEFAULT_GAMES,
        workers: 32,
        chunkSize: DEFAULT_CHUNK_SIZE,
        rngSeed: DEFAULT_RNG_SEED,
        decks: [...DECK_LABELS],
        opponents: [...DECK_LABELS],
        trace: false,
        outPrefix: path.join(__dirname, 'out', 'seed3-vs-seeds1-2'),
        help: false
    };
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
        } else if(arg === '--trace') {
            options.trace = true;
        } else if(arg === '--subject-seed') {
            options.subjectSeed = positiveInteger(argv[++index], arg);
        } else if(arg === '--opponent-seeds') {
            options.opponentSeeds = parseSeeds(argv[++index], arg);
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
    if(options.subjectSeed > 3) {
        throw new Error('--subject-seed must be 1, 2, or 3');
    }
    options.workers = Math.min(options.workers, 32);
    options.chunkSize = Math.min(options.chunkSize, options.games);
    if(!argv.includes('--out')) {
        options.outPrefix = path.join(
            __dirname,
            'out',
            `seed${options.subjectSeed}-vs-seeds${options.opponentSeeds.join('-')}`
        );
    }
    return options;
}

function buildJobs(options) {
    const jobs = [];
    let matchupOrdinal = 0;
    for(const opponentSeed of options.opponentSeeds) {
        for(const deck of options.decks) {
            for(const opponent of options.opponents) {
                const matchupRngSeed = options.rngSeed + matchupOrdinal * 100000;
                matchupOrdinal++;
                for(let startIndex = 0; startIndex < options.games; startIndex += options.chunkSize) {
                    jobs.push({
                        deck,
                        opponent,
                        opponentSeed,
                        startIndex,
                        games: Math.min(options.chunkSize, options.games - startIndex),
                        rngSeed: matchupRngSeed
                    });
                }
            }
        }
    }
    return jobs;
}

function parseJsonLines(value, results) {
    let remaining = value;
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

function runJob(job, options) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [
            '--max-old-space-size=1024', WORKER, job.deck, job.opponent,
            String(job.games), String(options.subjectSeed), String(job.opponentSeed),
            String(job.startIndex), String(job.rngSeed), options.trace ? 'trace' : 'no-trace'
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

function emptyRecord() {
    return { wins: 0, losses: 0, other: 0, played: 0 };
}

function completeRecord(record) {
    const resolved = record.wins + record.losses;
    return { ...record, winRate: resolved > 0 ? record.wins / resolved : null };
}

function addTrace(target, source) {
    for(const [reason, count] of Object.entries(source || {})) {
        target[reason] = (target[reason] || 0) + count;
    }
}

function summarize(options, jobResults) {
    const map = new Map(options.decks.map((deck) => [deck, {
        deck,
        ...emptyRecord(),
        bySeed: {},
        opponents: {},
        subjectTrace: {},
        opponentTrace: {},
        reasons: {},
        failedJobs: []
    }]));
    for(const job of jobResults) {
        const row = map.get(job.deck);
        const seed = row.bySeed[job.opponentSeed] || (row.bySeed[job.opponentSeed] = emptyRecord());
        const key = `${job.opponentSeed}:${job.opponent}`;
        const matchup = row.opponents[key] || (row.opponents[key] = {
            opponentSeed: job.opponentSeed,
            opponent: job.opponent,
            ...emptyRecord()
        });
        for(const result of job.results) {
            row.played++;
            seed.played++;
            matchup.played++;
            if(result.winner === 'subject') {
                row.wins++;
                seed.wins++;
                matchup.wins++;
            } else if(result.winner === 'opponent') {
                row.losses++;
                seed.losses++;
                matchup.losses++;
            } else {
                row.other++;
                seed.other++;
                matchup.other++;
            }
            const reason = `${result.winner || 'other'}:${result.reason || 'unknown'}`;
            row.reasons[reason] = (row.reasons[reason] || 0) + 1;
            addTrace(row.subjectTrace, result.subjectTrace);
            addTrace(row.opponentTrace, result.opponentTrace);
        }
        if(job.died) {
            row.failedJobs.push({
                opponentSeed: job.opponentSeed,
                opponent: job.opponent,
                startIndex: job.startIndex,
                cause: job.died,
                error: job.error
            });
        }
    }
    const deckSummaries = [...map.values()].map((row) => ({
        ...completeRecord(row),
        bySeed: Object.fromEntries(Object.entries(row.bySeed).map(([seed, value]) => [seed, completeRecord(value)])),
        opponents: Object.fromEntries(Object.entries(row.opponents).map(([key, value]) => [key, completeRecord(value)]))
    })).sort((left, right) => (right.winRate ?? -1) - (left.winRate ?? -1));
    const totals = completeRecord(deckSummaries.reduce((sum, row) => ({
        wins: sum.wins + row.wins,
        losses: sum.losses + row.losses,
        other: sum.other + row.other,
        played: sum.played + row.played
    }), emptyRecord()));
    return { deckSummaries, totals };
}

function percent(rate) {
    return rate === null || rate === undefined ? '--' : `${(rate * 100).toFixed(1)}%`;
}

function renderMarkdown(report) {
    const expected = report.config.games * report.config.opponents.length * report.config.opponentSeeds.length;
    const seedHeaders = report.config.opponentSeeds.map((seed) => `vs seed ${seed}`).join(' | ');
    const lines = [
        `# Seed ${report.config.subjectSeed} cross-seed round robin`, '',
        `Games per ordered deck/seed matchup: ${report.config.games}; RNG seed: ${report.config.rngSeed}.`,
        'Every subject deck plays every opponent deck. Seats alternate; paired games reuse shuffle streams.', '',
        `| Deck | Overall | ${seedHeaders} | 60% gate | Completed |`,
        `|---|---:|${report.config.opponentSeeds.map(() => '---:|').join('')}:---:|---:|`
    ];
    for(const row of report.deckSummaries) {
        const seedCells = report.config.opponentSeeds.map((seed) => {
            const result = row.bySeed[seed];
            return result ? `${result.wins}-${result.losses} (+${result.other}), ${percent(result.winRate)}` : '--';
        }).join(' | ');
        lines.push(`| ${row.deck} | ${row.wins}-${row.losses} (+${row.other}), ${percent(row.winRate)} | ` +
            `${seedCells} | ${row.winRate >= 0.6 ? 'PASS' : 'FAIL'} | ${row.played}/${expected} |`);
    }
    lines.push('', `Total: ${report.totals.wins}-${report.totals.losses} (+${report.totals.other}), ` +
        `${percent(report.totals.winRate)} seed ${report.config.subjectSeed}.`, '');
    return lines.join('\n');
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
    process.stderr.write(`seed ${options.subjectSeed} cross-seed round robin: ${totalGames} games, ${options.workers} workers\n`);
    await runPool(jobs, options.workers, (job) => runJob(job, options), (result, index) => {
        results[index] = result;
        completedJobs++;
        completedGames += result.results.length;
        process.stderr.write(`\rjobs ${completedJobs}/${jobs.length}; games ${completedGames}/${totalGames}`);
    });
    process.stderr.write('\n');
    const report = {
        generatedAt: new Date().toISOString(),
        config: {
            subjectSeed: options.subjectSeed,
            opponentSeeds: options.opponentSeeds,
            games: options.games,
            workers: options.workers,
            chunkSize: options.chunkSize,
            rngSeed: options.rngSeed,
            decks: options.decks,
            opponents: options.opponents,
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
}

if(require.main === module) {
    main().catch((error) => {
        console.error(error && error.stack || error);
        process.exit(1);
    });
}

module.exports = { buildJobs, parseArgs, renderMarkdown, summarize };
