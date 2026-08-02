'use strict';

// Full bot/deck round robin. Every unique deck pair plays N games with seats
// alternating. Matchups are split into isolated jobs and scheduled through a
// bounded child-process pool for parallelism, load balancing, and crash/hang
// containment.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { DECK_LABELS } = require('./deckRegistry.js');
const {
    STANDARD_ROUND_ROBIN_GAMES,
    roundRobinPayload,
    writeBenchmarkSection
} = require('./standardBenchmark.js');

const WORKER = path.join(__dirname, '_roundRobinWorker.js');
// One-shot latch so the worker configuration banner is echoed once, not 450 times.
let reportedWorkerConfig = false;
// Must stay comfortably above the harness per-game backstop (90s scaled), or a
// single slow game kills the whole chunk before that backstop can record it.
const PER_GAME_MS = 30000;
const DEFAULT_CHUNK_SIZE = 10;

function usage() {
    return `Usage: node tools/selfplay/botRoundRobin.js [options]

Runs every unique deck matchup. Seats alternate within each matchup.

Options:
  -n, --games <count>       Games per matchup (default: ${STANDARD_ROUND_ROBIN_GAMES})
  -w, --workers <count>     Parallel child processes (default: 24)
      --chunk-size <count>  Games per isolated job (default: ${DEFAULT_CHUNK_SIZE})
      --seed <number>       Both seats: 1 fate-aware, 2 old heuristic,
                            3 board-aware dynasty (default: 1)
      --omniscient          Give both seats exact hidden information
      --draw-bid <variant>  Both seats: adaptive or legacy (default: adaptive)
      --engine-version <v1|v2>
                            Both seats use this decision engine (default: v1)
      --v2-decks <a,b,...>  Only these decks pilot V2; the rest of the field
                            stays on V1. Overrides --engine-version. Use this to
                            compare one deck against the all-V1 baselines in
                            baselines/v1/, which were recorded with a V1 field.
      --v2-profile <json|file>
                            V2 profile override injected into the V2 seats
      --v2-mode <mode>      pass-through, shadow, or enabled (default: enabled)
      --subject <a,b,...>   Only run matchups INVOLVING these decks. Testing one
                            deck against the field is 9 matchups, not 45.
      --decks <a,b,...>     Limit round robin to named decks
      --out <path-prefix>   Report prefix (default: tools/selfplay/out/round-robin-latest)
  -h, --help                Show help

Available decks: ${DECK_LABELS.join(', ')}

Examples:
  node tools/selfplay/botRoundRobin.js
  node tools/selfplay/botRoundRobin.js --games 500 --workers 6
  node tools/selfplay/botRoundRobin.js --decks Crane,Crab,Lion --games 20
  node tools/selfplay/botRoundRobin.js --seed 2

  # V2 Crab against a V1 field, Crab matchups only (9 x 100 = 900 games)
  node tools/selfplay/botRoundRobin.js --games 100 --subject Crab --v2-decks Crab \
    --v2-mode pass-through --v2-profile '{"deckProfile":{...}}'`;
}

function positiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if(!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

// Leave two cores for the parent, the OS and the report writer. Oversubscribing
// does not just slow the batch: both game caps are wall clock, so contention
// turns finished games into `timeout` non-results.
function defaultWorkers() {
    return Math.max(1, Math.min(24, (os.cpus() || { length: 8 }).length - 2));
}

// How far past the machine we are running. Both wall-clock budgets scale by it
// so an explicitly oversubscribed run still measures games instead of killing
// them.
function loadScale(workers) {
    const cores = Math.max(1, (os.cpus() || { length: 8 }).length - 2);
    return Math.max(1, workers / cores);
}

/**
 * Should this matchup run?
 *
 * With no subjects, every pair does — the full round robin. With subjects, only
 * pairs involving one of them: testing a single deck against the field is 9
 * matchups, not 45, and the other 36 are V1-vs-V1 games that cost an hour and
 * answer nothing.
 */
function pairInScope(subjects, left, right) {
    return subjects.length === 0 || subjects.includes(left) || subjects.includes(right);
}

function parseArgs(argv) {
    const options = {
        games: STANDARD_ROUND_ROBIN_GAMES,
        workers: defaultWorkers(),
        chunkSize: DEFAULT_CHUNK_SIZE,
        botSeed: 1,
        engineVersion: 'v1',
        v2Mode: 'enabled',
        v2Decks: [],
        v2Profile: null,
        subjects: [],
        omniscient: false,
        drawBidPolicy: 'adaptive',
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
            if(options.botSeed > 3) {
                throw new Error('--seed must be a bot mode from 1 to 3');
            }
        } else if(arg === '--omniscient') {
            options.omniscient = true;
        } else if(arg === '--engine-version') {
            options.engineVersion = String(argv[++i] || '');
            if(!['v1', 'v2'].includes(options.engineVersion)) {
                throw new Error('--engine-version must be v1 or v2');
            }
        } else if(arg === '--v2-mode') {
            options.v2Mode = String(argv[++i] || '');
            if(!['pass-through', 'shadow', 'enabled'].includes(options.v2Mode)) {
                throw new Error('--v2-mode must be pass-through, shadow, or enabled');
            }
        } else if(arg === '--v2-decks') {
            const requested = String(argv[++i] || '').split(',').map((label) => label.trim()).filter(Boolean);
            const unknown = requested.filter((label) => !DECK_LABELS.includes(label));
            if(unknown.length > 0) {
                throw new Error(`--v2-decks has unknown deck(s): ${unknown.join(', ')}`);
            }
            options.v2Decks = [...new Set(requested)];
        } else if(arg === '--subject' || arg === '--subjects') {
            const requested = String(argv[++i] || '').split(',').map((label) => label.trim()).filter(Boolean);
            const unknown = requested.filter((label) => !DECK_LABELS.includes(label));
            if(unknown.length > 0) {
                throw new Error(`--subject has unknown deck(s): ${unknown.join(', ')}`);
            }
            if(requested.length === 0) {
                throw new Error('--subject needs at least one deck name');
            }
            options.subjects = [...new Set(requested)];
        } else if(arg === '--v2-profile') {
            const supplied = argv[++i];
            if(!supplied) {
                throw new Error('--v2-profile needs JSON or a path to a JSON file');
            }
            const text = fs.existsSync(supplied) ? fs.readFileSync(supplied, 'utf8') : supplied;
            try {
                options.v2Profile = JSON.parse(text);
            } catch(error) {
                throw new Error(`--v2-profile is not valid JSON: ${error.message}`);
            }
        } else if(arg === '--draw-bid') {
            options.drawBidPolicy = String(argv[++i] || '');
            if(!['adaptive', 'legacy'].includes(options.drawBidPolicy)) {
                throw new Error('--draw-bid must be adaptive or legacy');
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
        options.drawBidPolicy === 'adaptive' &&
        options.engineVersion === 'v1' &&
        // A run with any seat piloting V2 is not the V1 baseline, whatever else
        // matches. Without this the stored baseline the run is being COMPARED
        // against could be overwritten by the comparison itself.
        options.v2Decks.length === 0 &&
        !options.v2Profile &&
        options.subjects.length === 0 &&
        !options.omniscient &&
        allDecks &&
        report.matchups.length === expectedMatchups &&
        report.matchups.every((matchup) =>
            matchup.played === STANDARD_ROUND_ROBIN_GAMES && matchup.failedJobs.length === 0);
}

function buildJobs(decks, games, chunkSize, subjects = []) {
    const jobs = [];
    for(let leftIndex = 0; leftIndex < decks.length; leftIndex++) {
        for(let rightIndex = leftIndex + 1; rightIndex < decks.length; rightIndex++) {
            if(!pairInScope(subjects, decks[leftIndex], decks[rightIndex])) {
                continue;
            }
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

function runJob(job, botSeed, drawBidPolicy, omniscient, engineVersion, v2Mode,
    v2Decks = [], v2Profile = null, workers = defaultWorkers()) {
    // Both wall-clock budgets below stretch with oversubscription, so a batch
    // wider than the machine still measures games instead of killing them.
    const scale = loadScale(workers);
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [
            '--max-old-space-size=1024', WORKER, job.left, job.right,
            String(job.games), String(botSeed), String(job.startIndex), drawBidPolicy,
            String(omniscient), engineVersion, v2Mode, v2Decks.join(',')
        ], {
            cwd: path.join(__dirname, '..', '..'),
            env: {
                ...process.env,
                LOG_LEVEL: 'error',
                HARNESS_MAX_GAME_MS: String(Math.round(90000 * scale)),
                // JSON through a spawn argument is a quoting trap; use the env.
                ...(v2Profile ? { V2_PROFILE_JSON: JSON.stringify(v2Profile) } : {})
            }
        });
        const results = [];
        let stdout = '';
        let stderr = '';
        let killedFor = null;
        const timer = setTimeout(() => {
            killedFor = 'timeout';
            child.kill('SIGKILL');
        }, job.games * Math.round(PER_GAME_MS * scale) + 5000);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
            stdout = parseJsonLines(stdout, results);
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            // Surface the worker's own account of its configuration exactly
            // once. Child stderr is otherwise only reported when a job fails,
            // which means a silently-dropped override looks like a clean run.
            if(!reportedWorkerConfig && text.includes('[worker]')) {
                reportedWorkerConfig = true;
                process.stderr.write(text.slice(text.indexOf('[worker]')).split('\n')[0] + '\n');
            }
            stderr = (stderr + text).slice(-2000);
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

function summarize(decks, games, jobResults, subjects = []) {
    const matchupsByKey = new Map();
    for(let leftIndex = 0; leftIndex < decks.length; leftIndex++) {
        for(let rightIndex = leftIndex + 1; rightIndex < decks.length; rightIndex++) {
            const left = decks[leftIndex];
            const right = decks[rightIndex];
            if(!pairInScope(subjects, left, right)) {
                continue;
            }
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
    }).filter((summary) => summary.played > 0)
        .sort((a, b) => (b.averageOpponentWinRate ?? -1) - (a.averageOpponentWinRate ?? -1));

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
    // A subject-filtered run does not schedule every pair, so a matrix cell can
    // legitimately have no matchup behind it.
    if(!matchup) {
        return null;
    }
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
        `Engine: ${config.engineVersion}${config.engineVersion === 'v2' ? ` (${config.v2Mode})` : ''}  `,
        `Omniscient: ${config.omniscient ? 'yes' : 'no'}  `,
        `Draw bid policy: ${config.drawBidPolicy}  `,
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
    // The engine label has to name the V2 decks when only some seats pilot V2,
    // or the report reads as an all-V1 run and gets compared as one.
    const v2DeckList = report.config.v2Decks || [];
    const engineLabel = v2DeckList.length > 0
        ? `v2:${v2DeckList.join('+')}/${report.config.v2Mode} vs v1 field`
        : `${report.config.engineVersion}${report.config.engineVersion === 'v2' ? `/${report.config.v2Mode}` : ''}`;
    const subjectList = report.config.subjects || [];
    if(subjectList.length > 0) {
        console.log(`\nsubject decks: ${subjectList.join(', ')} ` +
            '(only matchups involving these ran)');
    }
    console.log(`\n=== Bot deck round robin (${engineLabel}, seed ${report.config.botSeed}${report.config.omniscient ? ' + omniscient' : ''}, draw ${report.config.drawBidPolicy}, N=${report.config.games}/matchup) ===\n`);
    if(report.config.v2Profile) {
        console.log(`v2 profile: ${JSON.stringify(report.config.v2Profile)}\n`);
    }
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

    const jobs = buildJobs(options.decks, options.games, options.chunkSize, options.subjects);
    // Count the matchups actually scheduled, not every possible pair — with a
    // subject filter those differ, and a banner that reports the wrong total is
    // exactly how a run gets misread as covering more than it did.
    const matchupCount = new Set(jobs.map((job) => pairKey(job.left, job.right))).size;
    const totalGames = matchupCount * options.games;
    const jobResults = new Array(jobs.length);
    let completedJobs = 0;
    let completedGames = 0;
    process.stderr.write(`round robin: ${options.decks.length} decks, ${matchupCount} matchups, ${totalGames} games, ${options.workers} workers\n`);

    await runPool(jobs, options.workers,
        (job) => runJob(job, options.botSeed, options.drawBidPolicy, options.omniscient,
            options.engineVersion, options.v2Mode, options.v2Decks, options.v2Profile,
            options.workers),
        (result, index) => {
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
            botSeed: options.botSeed,
            engineVersion: options.engineVersion,
            v2Mode: options.v2Mode,
            v2Decks: options.v2Decks,
            v2Profile: options.v2Profile,
            subjects: options.subjects,
            omniscient: options.omniscient,
            drawBidPolicy: options.drawBidPolicy
        },
        decks: options.decks,
        ...summarize(options.decks, options.games, jobResults, options.subjects)
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
    } else if(options.games === STANDARD_ROUND_ROBIN_GAMES &&
        options.drawBidPolicy === 'adaptive' && !options.omniscient && options.engineVersion === 'v1' &&
        options.decks.length === DECK_LABELS.length) {
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
