'use strict';

// All-deck bot interaction validator. It detects click/rejection cycles and
// decision-budget pressure independently from win rate.

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { seededRandom } = require('./analyzePolicyGame.js');
const { instrumentController, analyzeInteractionAudit } = require('./interactionAudit.js');

function usage() {
    return [
        'Usage: node tools/selfplay/validateBotInteractions.js [options]',
        '',
        'Options:',
        '  --games <n>                    Games per deck/opponent/seed (default 1)',
        '  --seeds <csv>                  Bot seeds (default 1,2,3)',
        '  --decks <csv|all>              Decks under audit (default all)',
        '  --opponents <csv|all>          Opponent decks (default Crane)',
        '  --rng-seed <n>                 Deterministic base RNG seed (default 20260716)',
        '  --max-rounds <n>               Per-game round cap (default 25)',
        '  --max-game-ms <n>              Per-game wall cap (default 30000)',
        '  --click-cap <n>                Maximum decisions in one controller tick (default 35)',
        '  --rejected-cap <n>             Rejections allowed per bot/game (default 3)',
        '  --no-progress-clicks <n>       Unchanged-state run threshold (default 4)',
        '  --repeated-action-clicks <n>   Same prompt/action run threshold (default 5)',
        '  --min-cycle-repeats <n>        Periodic cycle repeat threshold (default 3)',
        '  --max-cycle-period <n>         Longest detected cycle period (default 8)',
        '  --out <path-prefix>            Writes .json and .md (default out/bot-interactions-latest)',
        '  --help                         Show help',
        '',
        `Deck labels: ${DECK_LABELS.join(', ')}`,
        '',
        'Seeds 1, 2, and 3 are deployable deterministic policies.'
    ].join('\n');
}

function parseCsv(raw, allowed, label) {
    const values = raw === 'all' ? [...allowed] : String(raw).split(',').map((value) => value.trim()).filter(Boolean);
    const invalid = values.filter((value) => !allowed.includes(value));
    if(invalid.length > 0) {
        throw new Error(`Unknown ${label}: ${invalid.join(', ')}`);
    }
    return values;
}

function parseArgs(argv) {
    const options = {
        games: 1,
        seeds: [1, 2, 3],
        decks: [...DECK_LABELS],
        opponents: ['Crane'],
        rngSeed: 20260716,
        maxRounds: 25,
        maxGameMs: 30000,
        clickCap: 35,
        rejectedCap: 3,
        noProgressClicks: 4,
        repeatedActionClicks: 5,
        minCycleRepeats: 3,
        maxCyclePeriod: 8,
        out: path.join(__dirname, 'out', 'bot-interactions-latest')
    };
    const numericFlags = new Map([
        ['--games', 'games'],
        ['--rng-seed', 'rngSeed'],
        ['--max-rounds', 'maxRounds'],
        ['--max-game-ms', 'maxGameMs'],
        ['--click-cap', 'clickCap'],
        ['--rejected-cap', 'rejectedCap'],
        ['--no-progress-clicks', 'noProgressClicks'],
        ['--repeated-action-clicks', 'repeatedActionClicks'],
        ['--min-cycle-repeats', 'minCycleRepeats'],
        ['--max-cycle-period', 'maxCyclePeriod']
    ]);

    for(let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if(i + 1 >= argv.length) {
            throw new Error(`Missing value for ${arg}`);
        }
        const raw = argv[++i];
        if(arg === '--seeds') {
            options.seeds = String(raw).split(',').map(Number);
        } else if(arg === '--decks') {
            options.decks = parseCsv(raw, DECK_LABELS, 'deck label(s)');
        } else if(arg === '--opponents') {
            options.opponents = parseCsv(raw, DECK_LABELS, 'opponent label(s)');
        } else if(arg === '--out') {
            options.out = raw;
        } else if(numericFlags.has(arg)) {
            options[numericFlags.get(arg)] = Number(raw);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    const positive = ['games', 'maxRounds', 'maxGameMs', 'clickCap', 'noProgressClicks', 'repeatedActionClicks', 'minCycleRepeats', 'maxCyclePeriod'];
    for(const key of positive) {
        if(!Number.isInteger(options[key]) || options[key] <= 0) {
            throw new Error(`${key} must be a positive integer`);
        }
    }
    if(!Number.isInteger(options.rejectedCap) || options.rejectedCap < 0) {
        throw new Error('rejectedCap must be a non-negative integer');
    }
    if(options.seeds.length === 0 || options.seeds.some((seed) => !Number.isInteger(seed) || seed < 1 || seed > 3)) {
        throw new Error('seeds must be a comma-separated subset of 1,2,3');
    }
    return options;
}

function compactAudit(audit) {
    return {
        status: audit.status,
        issues: audit.issues,
        warnings: audit.warnings,
        decisions: audit.decisions,
        successful: audit.successful,
        rejected: audit.rejected,
        unsupported: audit.unsupported,
        forcedProgress: audit.forcedProgress,
        cycles: audit.cycles,
        noProgressRuns: audit.noProgressRuns,
        repeatedActionRuns: audit.repeatedActionRuns,
        budgetExhaustions: audit.budgetExhaustions,
        maxTickClicks: audit.maxTickClicks,
        clickCap: audit.clickCap,
        uniquePrompts: audit.uniquePrompts,
        uniqueCardsClicked: audit.uniqueCardsClicked,
        uniqueRingsClicked: audit.uniqueRingsClicked,
        byCommand: audit.byCommand,
        topInteractions: audit.topInteractions,
        rejectedSamples: audit.rejectedSamples,
        unsupportedSamples: audit.unsupportedSamples,
        forcedProgressSamples: audit.forcedProgressSamples
    };
}

function stopIssues(result) {
    const issues = [];
    if(result.error) {
        issues.push(`engine error: ${result.error}`);
    }
    if(['stalled', 'timeout', 'step-cap', 'unknown'].includes(result.stopReason)) {
        issues.push(`game stopped: ${result.stopReason}${result.stallSignature ? ` (${result.stallSignature})` : ''}`);
    }
    return issues;
}

async function runAuditGame(options, scenario) {
    const originalRandom = Math.random;
    Math.random = seededRandom(scenario.rngSeed);
    const targetName = `Audit-${scenario.deck}`;
    const opponentName = `Opponent-${scenario.opponent}`;
    const names = scenario.targetSecond ? [opponentName, targetName] : [targetName, opponentName];
    const targetIndex = names.indexOf(targetName);
    const opponentIndex = names.indexOf(opponentName);
    const targetDeck = getDeckLoader(scenario.deck)();
    const opponentDeck = getDeckLoader(scenario.opponent)();
    const decks = scenario.targetSecond
        ? { deckA: opponentDeck, deckB: targetDeck }
        : { deckA: targetDeck, deckB: opponentDeck };
    let instrumentation = [];

    try {
        const result = await runGame({
            names,
            seeds: [scenario.seed, scenario.seed],
            ...decks,
            trace: true,
            maxRounds: options.maxRounds,
            maxGameMs: options.maxGameMs,
            onControllers: (controllers) => {
                instrumentation = controllers.map((controller, index) =>
                    instrumentController(controller, controller.game, names[index]));
            }
        });
        const finished = instrumentation.map((entry) => {
            entry.finish();
            entry.maxDecisionsPerTick = 40;
            return compactAudit(analyzeInteractionAudit(entry, options));
        });
        const targetAudit = finished[targetIndex];
        const opponentAudit = finished[opponentIndex];
        const gameIssues = stopIssues(result);
        const issues = [
            ...gameIssues,
            ...targetAudit.issues.map((issue) => `target bot: ${issue}`),
            ...opponentAudit.issues.map((issue) => `opponent bot: ${issue}`)
        ];
        const warnings = [
            ...targetAudit.warnings.map((warning) => `target bot: ${warning}`),
            ...opponentAudit.warnings.map((warning) => `opponent bot: ${warning}`)
        ];
        const status = issues.length > 0 ? 'FAIL' : (warnings.length > 0 ? 'WARN' : 'PASS');
        return {
            ...scenario,
            status,
            issues,
            warnings,
            result,
            target: targetAudit,
            opponentAudit
        };
    } finally {
        Math.random = originalRandom;
    }
}

function aggregateRuns(runs) {
    const groups = new Map();
    for(const run of runs) {
        const key = `${run.deck}|${run.seed}`;
        if(!groups.has(key)) {
            groups.set(key, {
                deck: run.deck,
                seed: run.seed,
                games: 0,
                passes: 0,
                warnings: 0,
                failures: 0,
                decisions: 0,
                rejected: 0,
                unsupported: 0,
                forcedProgress: 0,
                cycles: 0,
                noProgressRuns: 0,
                repeatedActionRuns: 0,
                budgetExhaustions: 0,
                stalls: 0,
                maxTickClicks: 0,
                uniquePrompts: new Set(),
                uniqueCardsClicked: 0,
                uniqueRingsClicked: 0
            });
        }
        const row = groups.get(key);
        row.games++;
        if(run.status === 'FAIL') {
            row.failures++;
        } else if(run.status === 'WARN') {
            row.warnings++;
        } else {
            row.passes++;
        }
        const audits = [run.target, run.opponentAudit];
        row.decisions += audits.reduce((sum, audit) => sum + audit.decisions, 0);
        row.rejected += audits.reduce((sum, audit) => sum + audit.rejected, 0);
        row.unsupported += audits.reduce((sum, audit) => sum + audit.unsupported, 0);
        row.forcedProgress += audits.reduce((sum, audit) => sum + audit.forcedProgress, 0);
        row.cycles += audits.reduce((sum, audit) => sum + audit.cycles.length, 0);
        row.noProgressRuns += audits.reduce((sum, audit) => sum + audit.noProgressRuns.length, 0);
        row.repeatedActionRuns += audits.reduce((sum, audit) => sum + audit.repeatedActionRuns.length, 0);
        row.budgetExhaustions += audits.reduce((sum, audit) => sum + audit.budgetExhaustions.length, 0);
        row.stalls += ['stalled', 'timeout', 'step-cap', 'unknown'].includes(run.result.stopReason) ? 1 : 0;
        row.maxTickClicks = Math.max(row.maxTickClicks, ...audits.map((audit) => audit.maxTickClicks));
        row.uniqueCardsClicked += audits.reduce((sum, audit) => sum + audit.uniqueCardsClicked, 0);
        row.uniqueRingsClicked += audits.reduce((sum, audit) => sum + audit.uniqueRingsClicked, 0);
    }
    return Array.from(groups.values()).map((row) => ({
        ...row,
        status: row.failures > 0 ? 'FAIL' : (row.warnings > 0 ? 'WARN' : 'PASS'),
        uniquePrompts: undefined
    }));
}

function pad(value, width) {
    return String(value).padEnd(width);
}

function consoleTable(summary) {
    const widths = { deck: 19, seed: 5, status: 7, games: 7, decisions: 10, rejected: 9, loops: 7, budget: 8, maxTick: 8 };
    const lines = [
        `${pad('deck', widths.deck)}${pad('seed', widths.seed)}${pad('status', widths.status)}${pad('games', widths.games)}${pad('clicks', widths.decisions)}${pad('reject', widths.rejected)}${pad('loops', widths.loops)}${pad('budget', widths.budget)}${pad('max/tick', widths.maxTick)}`,
        '-'.repeat(Object.values(widths).reduce((sum, width) => sum + width, 0))
    ];
    for(const row of summary) {
        const loops = row.cycles + row.noProgressRuns + row.repeatedActionRuns;
        lines.push(`${pad(row.deck, widths.deck)}${pad(row.seed, widths.seed)}${pad(row.status, widths.status)}${pad(row.games, widths.games)}${pad(row.decisions, widths.decisions)}${pad(row.rejected, widths.rejected)}${pad(loops, widths.loops)}${pad(row.budgetExhaustions, widths.budget)}${pad(row.maxTickClicks, widths.maxTick)}`);
    }
    return lines.join('\n');
}

function markdownReport(payload) {
    const lines = [
        '# Bot interaction-cycle validation',
        '',
        `Generated: ${payload.generatedAt}`,
        '',
        `Games: ${payload.options.games} per deck/opponent/seed; seeds ${payload.options.seeds.join(', ')}; opponents ${payload.options.opponents.join(', ')}.`,
        '',
        '| deck | seed | status | games | clicks | rejected | unsupported | forced | cycles | no-progress | same-action | budgets | stalls | max/tick |',
        '|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
    ];
    for(const row of payload.summary) {
        lines.push(`| ${row.deck} | ${row.seed} | ${row.status} | ${row.games} | ${row.decisions} | ${row.rejected} | ${row.unsupported} | ${row.forcedProgress} | ${row.cycles} | ${row.noProgressRuns} | ${row.repeatedActionRuns} | ${row.budgetExhaustions} | ${row.stalls} | ${row.maxTickClicks} |`);
    }

    const failures = payload.runs.filter((run) => run.status === 'FAIL');
    const warnings = payload.runs.filter((run) => run.status === 'WARN');
    lines.push('', `Overall: **${failures.length > 0 ? 'FAIL' : (warnings.length > 0 ? 'WARN' : 'PASS')}** — ${failures.length} failed run(s), ${warnings.length} warning run(s), ${payload.runs.length} total.`, '');

    if(failures.length > 0) {
        lines.push('## Failures', '');
        for(const run of failures) {
            lines.push(`### ${run.deck} seed ${run.seed} vs ${run.opponent}, game ${run.game + 1}`, '');
            lines.push(`- RNG seed: ${run.rngSeed}`);
            const totalClicks = run.target.decisions + run.opponentAudit.decisions;
            const maxTickClicks = Math.max(run.target.maxTickClicks, run.opponentAudit.maxTickClicks);
            lines.push(`- Stop: ${run.result.stopReason}; rounds: ${run.result.rounds}; clicks: ${totalClicks}; max/tick: ${maxTickClicks}`);
            for(const issue of run.issues) {
                lines.push(`- ${issue}`);
            }
            const failingAudit = run.target.issues.length > 0 ? run.target : run.opponentAudit;
            const sample = failingAudit.cycles[0]?.sample || failingAudit.noProgressRuns[0]?.sample || failingAudit.repeatedActionRuns[0]?.sample || failingAudit.unsupportedSamples || failingAudit.forcedProgressSamples || failingAudit.rejectedSamples;
            if(sample && sample.length > 0) {
                lines.push('', '```json', JSON.stringify(sample.slice(0, 8), null, 2), '```');
            }
            lines.push('');
        }
    }

    if(warnings.length > 0) {
        lines.push('## Warnings', '');
        for(const run of warnings) {
            lines.push(`- ${run.deck} seed ${run.seed} vs ${run.opponent}, game ${run.game + 1}: ${run.warnings.join('; ')}`);
        }
        lines.push('');
    }

    lines.push('## Gates', '',
        `- Periodic cycles: ${payload.options.minCycleRepeats}+ repeats, period up to ${payload.options.maxCyclePeriod}.`,
        `- No-progress clicks: ${payload.options.noProgressClicks}+ accepted clicks with unchanged structural game state.`,
        `- Identical prompt/action: ${payload.options.repeatedActionClicks}+ consecutive clicks.`,
        `- Per-tick click cap: ${payload.options.clickCap}; controller hard budget is 40.`,
        `- Rejections: warning through ${payload.options.rejectedCap}, failure above it.`,
        '- Unsupported prompts, forced-progress recovery, controller budget exhaustion, stalls, timeouts, step caps, and engine errors always fail.',
        '',
        'Full per-run diagnostics and samples are in sibling JSON file.');
    return lines.join('\n');
}

async function runAll(options) {
    const runs = [];
    let ordinal = 0;
    const total = options.decks.length * options.opponents.length * options.seeds.length * options.games;
    for(const seed of options.seeds) {
        for(const deck of options.decks) {
            for(const opponent of options.opponents) {
                for(let game = 0; game < options.games; game++) {
                    const scenario = {
                        deck,
                        opponent,
                        seed,
                        game,
                        targetSecond: game % 2 === 1,
                        rngSeed: options.rngSeed + ordinal
                    };
                    ordinal++;
                    process.stderr.write(`[${ordinal}/${total}] ${deck} seed ${seed} vs ${opponent} rng ${scenario.rngSeed}\n`);
                    runs.push(await runAuditGame(options, scenario));
                }
            }
        }
    }
    return runs;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        console.log(usage());
        return;
    }
    const runs = await runAll(options);
    const payload = {
        generatedAt: new Date().toISOString(),
        options: { ...options, out: path.resolve(options.out) },
        summary: aggregateRuns(runs),
        runs
    };
    const prefix = path.resolve(options.out);
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(`${prefix}.json`, JSON.stringify(payload, null, 2));
    fs.writeFileSync(`${prefix}.md`, markdownReport(payload));
    console.log(consoleTable(payload.summary));
    console.log(`\nJSON: ${prefix}.json`);
    console.log(`Markdown: ${prefix}.md`);
    if(runs.some((run) => run.status === 'FAIL')) {
        process.exitCode = 1;
    }
}

if(require.main === module) {
    main().catch((err) => {
        console.error(err?.stack || err);
        process.exit(1);
    });
}

module.exports = {
    usage,
    parseArgs,
    runAuditGame,
    aggregateRuns,
    consoleTable,
    markdownReport,
    runAll
};
