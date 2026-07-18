'use strict';

// Full bot/deck round robin. Every unique deck pair plays N games with seats
// alternating. Matchups are split into isolated jobs and scheduled through a
// bounded child-process pool for parallelism, load balancing, and crash/hang
// containment.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DECK_LABELS } = require('./deckRegistry.js');
const {
    STANDARD_ROUND_ROBIN_GAMES,
    roundRobinPayload,
    writeBenchmarkSection
} = require('./standardBenchmark.js');

const WORKER = path.join(__dirname, '_roundRobinWorker.js');
const PER_GAME_MS = 12000;
const DEFAULT_CHUNK_SIZE = 10;

function usage() {
    return `Usage: node tools/selfplay/botRoundRobin.js [options]

Runs every unique deck matchup. Seats alternate within each matchup.

Options:
  -n, --games <count>       Games per matchup (default: ${STANDARD_ROUND_ROBIN_GAMES})
  -w, --workers <count>     Parallel child processes (default: 32)
      --chunk-size <count>  Games per isolated job (default: ${DEFAULT_CHUNK_SIZE})
      --seed <number>       Both seats: 1 fate-aware, 2 old heuristic, 3 LLM,
                            4 learned evaluator, 5 omniscient (default: 1)
      --decks <a,b,...>     Limit round robin to named decks
      --out <path-prefix>   Report prefix (default: tools/selfplay/out/round-robin-latest)
  -h, --help                Show help

Available decks: ${DECK_LABELS.join(', ')}

Examples:
  node tools/selfplay/botRoundRobin.js
  node tools/selfplay/botRoundRobin.js --games 500 --workers 6
  node tools/selfplay/botRoundRobin.js --decks Crane,Crab,Lion --games 20
  node tools/selfplay/botRoundRobin.js --seed 2`;
}

function positiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if(!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

function defaultWorkers() {
    return 32;
}

function parseArgs(argv) {
    const options = {
        games: STANDARD_ROUND_ROBIN_GAMES,
        workers: defaultWorkers(),
        chunkSize: DEFAULT_CHUNK_SIZE,
        botSeed: 1,
        decks: [...DECK_LABELS],
        outPrefix: path.join(__dirname, 'out', 'round-robin-latest'),
        help: false
    };

    for(let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if(arg === '-h' || arg === '--help') {
            options.help = true;
        } else if(arg === '-n' || arg === '--games') {
            options.games = positiveInteger(argv[++i], arg);
        } else if(arg === '-w' || arg === '--workers') {
            options.workers = positiveInteger(argv[++i], arg);
        } else if(arg === '--chunk-size') {
            options.chunkSize = positiveInteger(argv[++i], arg);
        } else if(arg === '--seed') {
            options.botSeed = positiveInteger(argv[++i], arg);
            if(options.botSeed > 5) {
                throw new Error('--seed must be a bot mode from 1 to 5');
            }
        } else if(arg === '--decks') {
            const requested = String(argv[++i] || '').split(',').map((label) => label.trim()).filter(Boolean);
            const unknown = requested.filter((label) => !DECK_LABELS.includes(label));
            if(unknown.length > 0) {
                throw new Error(`unknown deck(s): ${unknown.join(', ')}`);
            }
            if(new Set(requested).size < 2) {
                throw new Error('--decks needs at least two unique deck names');
            }
            options.decks = [...new Set(requested)];
        } else if(arg === '--out') {
            const supplied = argv[++i];
            if(!supplied) {
                throw new Error('--out needs a path prefix');
            }
            options.outPrefix = path.resolve(supplied);
        } else {
            throw new Error(`unknown option: ${arg}`);
        }
    }

    options.workers = Math.min(options.workers, 32);
    options.chunkSize = Math.min(options.chunkSize, options.games);
    return options;
}

function isStandardBenchmarkRun(options, report) {
    const allDecks = options.decks.length === DECK_LABELS.length &&
        DECK_LABELS.every((deck) => options.decks.includes(deck));
    const expectedMatchups = DECK_LABELS.length * (DECK_LABELS.length - 1) / 2;
    return options.games === STANDARD_ROUND_ROBIN_GAMES &&
        allDecks &&
        report.matchups.length === expectedMatchups &&
        report.matchups.every((matchup) =>
            matchup.played === STANDARD_ROUND_ROBIN_GAMES && matchup.failedJobs.length === 0);
}

function buildJobs(decks, games, chunkSize) {
    const jobs = [];
    for(let leftIndex = 0; leftIndex < decks.length; leftIndex++) {
        for(let rightIndex = leftIndex + 1; rightIndex < decks.length; rightIndex++) {
            for(let startIndex = 0; startIndex < games; startIndex += chunkSize) {
                jobs.push({
                    left: decks[leftIndex],
                    right: decks[rightIndex],
                    startIndex,
                    games: Math.min(chunkSize, games - startIndex)
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
                // Logger noise is not game output.
            }
        }
    }
    return remaining;
}

function runJob(job, botSeed) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [
            '--max-old-space-size=1024', WORKER, job.left, job.right,
            String(job.games), String(botSeed), String(job.startIndex)
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
            parseJsonLines(stdout + '\n', results);
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

function pairKey(left, right) {
    return `${left}::${right}`;
}

function summarize(decks, games, jobResults) {
    const matchupsByKey = new Map();
    for(let leftIndex = 0; leftIndex < decks.length; leftIndex++) {
        for(let rightIndex = leftIndex + 1; rightIndex < decks.length; rightIndex++) {
            const left = decks[leftIndex];
            const right = decks[rightIndex];
            matchupsByKey.set(pairKey(left, right), {
                left, right, targetGames: games, played: 0,
                leftWins: 0, rightWins: 0, other: 0, reasons: {}, failedJobs: []
            });
        }
    }

    for(const job of jobResults) {
        const matchup = matchupsByKey.get(pairKey(job.left, job.right));
        for(const result of job.results) {
            matchup.played++;
            if(result.winner === matchup.left) {
                matchup.leftWins++;
            } else if(result.winner === matchup.right) {
                matchup.rightWins++;
            } else {
                matchup.other++;
            }
            const reason = `${result.winner || 'none'}:${result.reason || 'none'}`;
            matchup.reasons[reason] = (matchup.reasons[reason] || 0) + 1;
        }
        if(job.died) {
            matchup.failedJobs.push({
                startIndex: job.startIndex,
                requested: job.games,
                played: job.results.length,
                cause: job.died,
                error: job.error
            });
        }
    }

    const matchups = [...matchupsByKey.values()];
    const deckSummaries = decks.map((deck) => {
        let wins = 0;
        let losses = 0;
        let other = 0;
        const opponentRates = [];
        for(const matchup of matchups) {
            if(matchup.left !== deck && matchup.right !== deck) {
                continue;
            }
            const deckWins = matchup.left === deck ? matchup.leftWins : matchup.rightWins;
            const deckLosses = matchup.left === deck ? matchup.rightWins : matchup.leftWins;
            wins += deckWins;
            losses += deckLosses;
            other += matchup.other;
            if(deckWins + deckLosses > 0) {
                opponentRates.push(deckWins / (deckWins + deckLosses));
            }
        }
        return {
            deck, wins, losses, other,
            played: wins + losses + other,
            overallWinRate: wins + losses > 0 ? wins / (wins + losses) : null,
            averageOpponentWinRate: opponentRates.length > 0
                ? opponentRates.reduce((sum, rate) => sum + rate, 0) / opponentRates.length
                : null,
            opponentsCompleted: opponentRates.length
        };
    }).sort((a, b) => (b.averageOpponentWinRate ?? -1) - (a.averageOpponentWinRate ?? -1));

    return { matchups, deckSummaries };
}

function percent(rate, digits = 1) {
    return rate === null ? '--' : `${(rate * 100).toFixed(digits)}%`;
}

function matchupFor(matchups, deck, opponent) {
    return matchups.find((matchup) =>
        (matchup.left === deck && matchup.right === opponent) ||
        (matchup.left === opponent && matchup.right === deck));
}

function deckRate(matchup, deck) {
    const wins = matchup.left === deck ? matchup.leftWins : matchup.rightWins;
    const losses = matchup.left === deck ? matchup.rightWins : matchup.leftWins;
    return wins + losses > 0 ? wins / (wins + losses) : null;
}

function renderMarkdown(report) {
    const { generatedAt, config, decks, matchups, deckSummaries } = report;
    const lines = [
        '# Bot Deck Round Robin', '', `Generated: ${generatedAt}`, '',
        `Games per matchup: ${config.games}  `,
        `Bot seed: ${config.botSeed}  `,
        `Workers: ${config.workers}  `,
        `Chunk size: ${config.chunkSize}`, '',
        'Win rates exclude stalled/undecided games. Seats alternate. “Average vs opponents” is macro-average: every opposing deck has equal weight.', '',
        '## Average Results', '',
        '| Deck | Record | Undecided | Overall win rate | Average vs opponents | Opponents with results |',
        '|---|---:|---:|---:|---:|---:|'
    ];
    for(const row of deckSummaries) {
        lines.push(`| ${row.deck} | ${row.wins}-${row.losses} | ${row.other} | ${percent(row.overallWinRate)} | ${percent(row.averageOpponentWinRate)} | ${row.opponentsCompleted}/${decks.length - 1} |`);
    }

    lines.push('', '## Matchup Matrix', '');
    lines.push(`| Deck | ${decks.join(' | ')} |`);
    lines.push(`|---|${decks.map(() => '---:').join('|')}|`);
    for(const deck of decks) {
        const cells = decks.map((opponent) => deck === opponent
            ? '—'
            : percent(deckRate(matchupFor(matchups, deck, opponent), deck)));
        lines.push(`| ${deck} | ${cells.join(' | ')} |`);
    }

    lines.push('', '## Matchup Details', '');
    for(const matchup of matchups) {
        const failures = matchup.failedJobs.length > 0
            ? ` **Partial: ${matchup.failedJobs.length} job(s) failed.**`
            : '';
        lines.push(`- **${matchup.left} vs ${matchup.right}:** ${matchup.leftWins}-${matchup.rightWins}, ${matchup.other} undecided (${matchup.played}/${matchup.targetGames} played).${failures}`);
    }
    lines.push('');
    return lines.join('\n');
}

function printConsole(report, jsonPath, markdownPath) {
    console.log(`\n=== Bot deck round robin (seed ${report.config.botSeed}, N=${report.config.games}/matchup) ===\n`);
    console.log('deck              record       avg vs opponents  overall');
    console.log('----------------  -----------  ----------------  -------');
    for(const row of report.deckSummaries) {
        const record = `${row.wins}-${row.losses}${row.other ? ` (+${row.other})` : ''}`;
        console.log(`${row.deck.padEnd(16)}  ${record.padEnd(11)}  ${percent(row.averageOpponentWinRate).padStart(16)}  ${percent(row.overallWinRate).padStart(7)}`);
    }
    const failures = report.matchups.reduce((count, matchup) => count + matchup.failedJobs.length, 0);
    console.log(`\nReports: ${markdownPath}\n         ${jsonPath}`);
    if(failures > 0) {
        console.log(`Warning: ${failures} worker job(s) incomplete; reports preserve partial results.`);
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        console.log(usage());
        return;
    }

    const jobs = buildJobs(options.decks, options.games, options.chunkSize);
    const matchupCount = options.decks.length * (options.decks.length - 1) / 2;
    const totalGames = matchupCount * options.games;
    const jobResults = new Array(jobs.length);
    let completedJobs = 0;
    let completedGames = 0;
    process.stderr.write(`round robin: ${options.decks.length} decks, ${matchupCount} matchups, ${totalGames} games, ${options.workers} workers\n`);

    await runPool(jobs, options.workers, (job) => runJob(job, options.botSeed), (result, index) => {
        jobResults[index] = result;
        completedJobs++;
        completedGames += result.results.length;
        process.stderr.write(`\rjobs ${completedJobs}/${jobs.length}; games ${completedGames}/${totalGames}`);
    });
    process.stderr.write('\n');

    const report = {
        generatedAt: new Date().toISOString(),
        config: {
            games: options.games,
            workers: options.workers,
            chunkSize: options.chunkSize,
            botSeed: options.botSeed
        },
        decks: options.decks,
        ...summarize(options.decks, options.games, jobResults)
    };
    const jsonPath = `${options.outPrefix}.json`;
    const markdownPath = `${options.outPrefix}.md`;
    fs.mkdirSync(path.dirname(options.outPrefix), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(markdownPath, renderMarkdown(report));
    printConsole(report, jsonPath, markdownPath);

    if(isStandardBenchmarkRun(options, report)) {
        const configPath = writeBenchmarkSection(
            options.botSeed,
            'roundRobin',
            roundRobinPayload(report)
        );
        console.log(`Standard client benchmark updated: ${configPath}`);
    } else if(options.games === STANDARD_ROUND_ROBIN_GAMES && options.decks.length === DECK_LABELS.length) {
        console.log('Standard client benchmark not updated: run was incomplete.');
    }
}

if(require.main === module) {
    main().catch((error) => {
        console.error(error && error.stack || error);
        process.exit(1);
    });
}

module.exports = {
    buildJobs,
    defaultWorkers,
    isStandardBenchmarkRun,
    parseArgs,
    renderMarkdown,
    summarize
};
