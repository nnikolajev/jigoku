'use strict';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

// Paired engine-version comparison. A pass-through candidate is replayed
// beside an all-V1 control with the same deck order, seats, strategy seed,
// information mode, and deterministic Math.random stream.

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { stableConfigurationHash } = require('../../build/server/game/bots/BotConfiguration.js');

const DEFAULT_RNG_SEED = 20260721;

function usage() {
    return `Usage: node tools/selfplay/compareBotVersions.js [options]

  --candidate-engine <v1|v2>  Candidate engine (default v2)
  --control-engine <v1|v2>    Control engine (default v1)
  --v2-mode <mode>             Candidate V2 mode (default pass-through)
  --seed <1|2|3>               Shared strategy seed (default 1)
  --mode <fair|omniscient>     Shared information mode (default fair)
  --decks <all|csv>            Mirror decks (default all)
  --games <even-n>             Games per deck; seats alternate (default 2)
  --rng-seed <n>               Paired deterministic RNG seed
  --include-traces             Include benchmark-level V2 decision traces for regret mining
  --out <prefix>               JSON/Markdown output prefix
  --require-equivalence        Exit nonzero on any outcome/trace mismatch`;
}

function positiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if(!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

function parseArgs(argv = []) {
    const options = {
        candidateEngine: 'v2', controlEngine: 'v1', v2Mode: 'pass-through',
        seed: 1, mode: 'fair', decks: [...DECK_LABELS], games: 2,
        rngSeed: DEFAULT_RNG_SEED, requireEquivalence: false, includeTraces: false,
        outPrefix: undefined
    };
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help') {
            options.help = true;
        } else if(arg === '--candidate-engine') {
            options.candidateEngine = String(argv[++index]);
        } else if(arg === '--control-engine') {
            options.controlEngine = String(argv[++index]);
        } else if(arg === '--v2-mode') {
            options.v2Mode = String(argv[++index]);
        } else if(arg === '--seed') {
            options.seed = positiveInteger(argv[++index], arg);
        } else if(arg === '--mode') {
            options.mode = String(argv[++index]);
        } else if(arg === '--decks') {
            const value = String(argv[++index] || '');
            options.decks = value === 'all' ? [...DECK_LABELS] : value.split(',').map((entry) => entry.trim()).filter(Boolean);
        } else if(arg === '--games') {
            options.games = positiveInteger(argv[++index], arg);
        } else if(arg === '--rng-seed') {
            options.rngSeed = positiveInteger(argv[++index], arg);
        } else if(arg === '--out') {
            options.outPrefix = path.resolve(argv[++index]);
        } else if(arg === '--require-equivalence') {
            options.requireEquivalence = true;
        } else if(arg === '--include-traces') {
            options.includeTraces = true;
        } else {
            throw new Error(`unknown option ${arg}`);
        }
    }
    if(!['v1', 'v2'].includes(options.candidateEngine) || !['v1', 'v2'].includes(options.controlEngine)) {
        throw new Error('engine versions must be v1 or v2');
    }
    if(!['fair', 'omniscient'].includes(options.mode)) {
        throw new Error('--mode must be fair or omniscient');
    }
    if(options.seed > 3) {
        throw new Error('--seed must be 1, 2, or 3');
    }
    if(options.games % 2 !== 0) {
        throw new Error('--games must be even so seats are paired');
    }
    const unknown = options.decks.filter((deck) => !DECK_LABELS.includes(deck));
    if(unknown.length > 0 || options.decks.length === 0) {
        throw new Error(`unknown deck(s): ${unknown.join(', ') || '(none)'}`);
    }
    if(!options.outPrefix) {
        options.outPrefix = path.join(__dirname, 'out',
            `${options.candidateEngine}-vs-${options.controlEngine}-seed${options.seed}-${options.mode}-${options.v2Mode}`);
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

function normalizedTrace(trace = []) {
    return trace.map((entry) => ({
        player: entry.player,
        promptTitle: String(entry.promptTitle || '').replace(/Attacker:\s*-?\d+\s*Defender:\s*-?\d+/gi, 'Attacker: N Defender: N'),
        menuTitle: String(entry.menuTitle || '').replace(/Attacker:\s*-?\d+\s*Defender:\s*-?\d+/gi, 'Attacker: N Defender: N'),
        command: entry.command,
        semanticArg: entry.command === 'cardClicked'
            ? entry.cardId || entry.cardLocation || entry.target
            : entry.command === 'menuItemClick' || entry.command === 'ringMenuItemClick'
                ? entry.args?.[1]
                : entry.args?.[0],
        target: entry.command === 'cardClicked' && entry.target === entry.args?.[0]
            ? entry.cardId || entry.cardLocation || 'masked-card'
            : entry.target,
        cardId: entry.cardId,
        cardLocation: entry.cardLocation,
        reason: entry.reason,
        result: entry.result,
        seedState: entry.seedState
    }));
}

function firstTraceDifference(candidate = {}, control = {}) {
    const names = [...new Set([...Object.keys(candidate), ...Object.keys(control)])].sort();
    for(const name of names) {
        const candidateTrace = candidate[name] || [];
        const controlTrace = control[name] || [];
        const length = Math.max(candidateTrace.length, controlTrace.length);
        for(let index = 0; index < length; index++) {
            if(JSON.stringify(candidateTrace[index]) !== JSON.stringify(controlTrace[index])) {
                return {
                    player: name,
                    index,
                    candidateLength: candidateTrace.length,
                    controlLength: controlTrace.length,
                    candidate: candidateTrace[index] || null,
                    control: controlTrace[index] || null
                };
            }
        }
    }
    return undefined;
}

function tracesByName(controllers) {
    return Object.fromEntries(controllers.map((controller) => [
        controller.config.playerName,
        normalizedTrace(controller.trace)
    ]));
}

function v2OverridesByName(controllers) {
    return Object.fromEntries(controllers.map((controller) => [
        controller.config.playerName,
        controller.trace.filter((entry) => entry.selectedBy === 'v2').map((entry) => ({
            promptTitle: entry.promptTitle,
            menuTitle: entry.menuTitle,
            command: entry.command,
            args: entry.args,
            target: entry.target,
            cardId: entry.cardId,
            result: entry.result,
            reason: entry.reason,
            fallbackReason: entry.fallbackReason,
            engineVersion: entry.engineVersion,
            strategySeed: entry.strategySeed,
            informationMode: entry.informationMode,
            deckProfile: entry.deckProfile,
            configurationHash: entry.configurationHash,
            durationMs: entry.durationMs,
            planner: entry.planner,
            terminal: entry.planner?.terminal,
            disagreementType: entry.planner?.disagreementType,
            scoreGap: entry.planner?.scoreGap
        }))
    ]));
}

function v2TraceByName(controllers) {
    return Object.fromEntries(controllers.map((controller) => [
        controller.config.playerName,
        controller.trace.filter((entry) => entry.engineVersion === 'v2').map((entry) => ({
            player: entry.player,
            promptTitle: entry.promptTitle,
            menuTitle: entry.menuTitle,
            command: entry.command,
            args: entry.args,
            target: entry.target,
            cardId: entry.cardId,
            result: entry.result,
            reason: entry.reason,
            selectedBy: entry.selectedBy,
            fallbackReason: entry.fallbackReason,
            engineVersion: entry.engineVersion,
            strategySeed: entry.strategySeed,
            informationMode: entry.informationMode,
            deckProfile: entry.deckProfile,
            configurationHash: entry.configurationHash,
            durationMs: entry.durationMs,
            planner: entry.planner
        }))
    ]));
}

function wilson(wins, played, z = 1.96) {
    if(played === 0) {
        return [null, null];
    }
    const p = wins / played;
    const denominator = 1 + z * z / played;
    const center = (p + z * z / (2 * played)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * played)) / played) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

async function replay(options, deck, deckIndex, gameIndex, candidateVersion) {
    const candidateFirst = gameIndex % 2 === 0;
    const names = candidateFirst ? ['Candidate', 'Control'] : ['Control', 'Candidate'];
    const versions = candidateFirst
        ? [candidateVersion, options.controlEngine]
        : [options.controlEngine, candidateVersion];
    const omniscient = [options.mode === 'omniscient', options.mode === 'omniscient'];
    const loader = getDeckLoader(deck);
    let controllers;
    const pairSeed = options.rngSeed + deckIndex * 100000 + Math.floor(gameIndex / 2);
    Math.random = seededRandom(pairSeed);
    const result = await runGame({
        names,
        seeds: [options.seed, options.seed],
        deckA: loader(),
        deckB: loader(),
        engineVersions: versions,
        v2Modes: versions.map((version) => version === 'v2' ? options.v2Mode : undefined),
        omniscient,
        traceLevels: versions.map((version) => version === 'v2'
            ? options.includeTraces ? 'research' : 'benchmark'
            : 'production'),
        trace: true,
        onControllers: (created) => { controllers = created; }
    });
    return {
        result,
        traces: tracesByName(controllers),
        v2Overrides: v2OverridesByName(controllers),
        v2Trace: v2TraceByName(controllers),
        pairSeed
    };
}

function emptyPlannerMetrics() {
    return {
        decisions: 0, fallbackDecisions: 0, v2Decisions: 0,
        searchedNodes: 0, plannerMs: 0, budgetExhaustions: 0,
        plannerErrors: 0, planChurn: 0, tacticalCorrections: 0,
        thresholdQualifiedPreferences: 0, provenDisagreements: 0,
        likelyDisagreements: 0, uncertainDisagreements: 0,
        scoringGaps: 0, semanticGaps: 0, v1Preferred: 0, agreements: 0
    };
}

function collectPlannerMetrics(entries = []) {
    const metrics = emptyPlannerMetrics();
    const intentHistory = [];
    let previousIntent;
    for(const entry of entries) {
        if(entry.engineVersion !== 'v2') continue;
        const planner = entry.planner || {};
        metrics.decisions++;
        metrics.plannerMs += Number(entry.durationMs) || 0;
        metrics.searchedNodes += Number(planner.budget?.searchedNodes) || 0;
        if(entry.selectedBy === 'fallback') metrics.fallbackDecisions++;
        if(entry.selectedBy === 'v2') metrics.v2Decisions++;
        if(planner.budget?.exhausted || entry.fallbackReason === 'search-budget-exhausted') metrics.budgetExhaustions++;
        if(String(entry.fallbackReason || planner.fallbackReason || '').startsWith('planner-error:')) metrics.plannerErrors++;
        if(entry.selectedBy === 'v2' && ['proven-v2-improvement', 'likely-improvement'].includes(planner.disagreementType)) {
            metrics.tacticalCorrections++;
        }
        if(Number(planner.confidence) >= 0.9 && Number(planner.scoreGap) >= 3) {
            metrics.thresholdQualifiedPreferences++;
        }
        const disagreementMetric = {
            'proven-v2-improvement': 'provenDisagreements',
            'likely-improvement': 'likelyDisagreements',
            uncertain: 'uncertainDisagreements',
            'scoring-gap': 'scoringGaps',
            'semantic-gap': 'semanticGaps',
            'v1-preferred': 'v1Preferred',
            agreement: 'agreements'
        }[planner.disagreementType];
        if(disagreementMetric) metrics[disagreementMetric]++;
        const explicitChurn = ['opponent-disruption', 'macro-mismatch', 'command-rejected'].includes(planner.intentInvalidation);
        const oscillated = planner.intentId && previousIntent && planner.intentId !== previousIntent &&
            intentHistory.slice(-4).includes(planner.intentId);
        if(planner.intentId && previousIntent && planner.intentId !== previousIntent && (explicitChurn || oscillated)) {
            metrics.planChurn++;
        }
        if(planner.intentId) {
            previousIntent = planner.intentId;
            intentHistory.push(planner.intentId);
        }
    }
    return metrics;
}

function addPlannerMetrics(target, entries) {
    const metrics = collectPlannerMetrics(entries);
    for(const key of Object.keys(metrics)) target[key] += metrics[key];
}

function finalizePlannerMetrics(target) {
    target.fallbackRate = target.decisions ? target.fallbackDecisions / target.decisions : null;
    target.meanNodesPerDecision = target.decisions ? target.searchedNodes / target.decisions : 0;
    target.meanPlannerMs = target.decisions ? target.plannerMs / target.decisions : 0;
    target.planChurnRate = target.decisions ? target.planChurn / target.decisions : 0;
    target.tacticalCorrectionRate = target.decisions ? target.tacticalCorrections / target.decisions : 0;
}

function markdown(report) {
    const percent = (value) => value === null ? '-' : `${(value * 100).toFixed(1)}%`;
    const lines = [
        `# ${report.config.candidateEngine.toUpperCase()} versus ${report.config.controlEngine.toUpperCase()}`,
        '',
        `Seed ${report.config.seed}; ${report.config.mode}; ${report.config.games} games/deck; paired RNG ${report.config.rngSeed}; V2 mode ${report.config.v2Mode}.`,
        '',
        '| Deck | Candidate record | Win rate (95% CI) | Outcome equal | Trace equal | Fallback | Nodes/decision | Planner ms/decision | Corrections |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
    ];
    for(const row of report.decks) {
        lines.push(`| ${row.deck} | ${row.wins}-${row.losses} (+${row.other}) | ${percent(row.winRate)} (${percent(row.confidence95[0])}-${percent(row.confidence95[1])}) | ${row.outcomeEquivalent}/${row.played} | ${row.traceEquivalent}/${row.played} | ${percent(row.fallbackRate)} | ${row.meanNodesPerDecision.toFixed(1)} | ${row.meanPlannerMs.toFixed(2)} | ${row.tacticalCorrections} |`);
    }
    lines.push('',
        `Aggregate: ${report.totals.wins}-${report.totals.losses} (+${report.totals.other}), ${percent(report.totals.winRate)}; ` +
        `outcome equivalence ${report.totals.outcomeEquivalent}/${report.totals.played}; trace equivalence ${report.totals.traceEquivalent}/${report.totals.played}.`,
        '',
        `Fallback rate: ${percent(report.totals.fallbackRate)}; plan churn ${report.totals.planChurn}/${report.totals.decisions}; tactical corrections ${report.totals.tacticalCorrections}.`,
        `Evidence gate: ${report.totals.thresholdQualifiedPreferences} preference(s) met confidence >= 0.90 and score advantage >= 3; disagreements proven/likely/uncertain/scoring/semantic/V1-preferred/agreement: ${report.totals.provenDisagreements}/${report.totals.likelyDisagreements}/${report.totals.uncertainDisagreements}/${report.totals.scoringGaps}/${report.totals.semanticGaps}/${report.totals.v1Preferred}/${report.totals.agreements}.`,
        `Planner: ${report.totals.meanNodesPerDecision.toFixed(1)} nodes/decision, ${report.totals.meanPlannerMs.toFixed(2)} ms/decision, ${report.totals.budgetExhaustions} budget exhaustion(s), ${report.totals.plannerErrors} planner error(s). Runtime candidate/control: ${report.totals.meanCandidateMs.toFixed(1)}/${report.totals.meanControlMs.toFixed(1)} ms/game.`,
        ''
    );
    return `${lines.join('\n')}\n`;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const originalRandom = Math.random;
    const rows = [];
    try {
        for(const [deckIndex, deck] of options.decks.entries()) {
            const row = {
                deck, wins: 0, losses: 0, other: 0, played: 0,
                opponentDeck: deck,
                candidateEngine: options.candidateEngine,
                controlEngine: options.controlEngine,
                strategySeed: options.seed,
                informationMode: options.mode,
                pairedRng: true,
                seats: { candidateFirst: 0, candidateSecond: 0 },
                victoryTypes: {},
                outcomeEquivalent: 0, traceEquivalent: 0,
                candidateMs: 0, controlMs: 0, ...emptyPlannerMetrics(), samples: []
            };
            for(let gameIndex = 0; gameIndex < options.games; gameIndex++) {
                const control = await replay(options, deck, deckIndex, gameIndex, options.controlEngine);
                const candidate = await replay(options, deck, deckIndex, gameIndex, options.candidateEngine);
                row.played++;
                if(gameIndex % 2 === 0) row.seats.candidateFirst++;
                else row.seats.candidateSecond++;
                row.candidateMs += candidate.result.elapsedMs;
                row.controlMs += control.result.elapsedMs;
                addPlannerMetrics(row, candidate.v2Trace.Candidate || []);
                if(candidate.result.winner === 'Candidate') row.wins++;
                else if(candidate.result.winner === 'Control') row.losses++;
                else row.other++;
                const candidateOutcome = { winner: candidate.result.winner, reason: candidate.result.winReason, stop: candidate.result.stopReason };
                const controlOutcome = { winner: control.result.winner, reason: control.result.winReason, stop: control.result.stopReason };
                const victoryType = `${candidateOutcome.winner || 'none'}:${candidateOutcome.reason || candidateOutcome.stop || 'none'}`;
                row.victoryTypes[victoryType] = (row.victoryTypes[victoryType] || 0) + 1;
                const outcomeEqual = JSON.stringify(candidateOutcome) === JSON.stringify(controlOutcome);
                if(outcomeEqual) {
                    row.outcomeEquivalent++;
                }
                const traceEqual = JSON.stringify(candidate.traces) === JSON.stringify(control.traces);
                if(traceEqual) {
                    row.traceEquivalent++;
                }
                const sample = {
                    game: gameIndex + 1,
                    pairSeed: candidate.pairSeed,
                    candidateOutcome,
                    controlOutcome,
                    outcomeEqual,
                    traceEqual,
                    v2Overrides: candidate.v2Overrides.Candidate || []
                };
                if(!traceEqual) sample.firstTraceDifference = firstTraceDifference(candidate.traces, control.traces);
                if(options.includeTraces) sample.v2Trace = candidate.v2Trace.Candidate || [];
                row.samples.push(sample);
                process.stderr.write(`\r${deck} ${gameIndex + 1}/${options.games}`);
            }
            row.winRate = row.played ? row.wins / row.played : null;
            row.confidence95 = wilson(row.wins, row.played);
            row.meanCandidateMs = row.candidateMs / row.played;
            row.meanControlMs = row.controlMs / row.played;
            finalizePlannerMetrics(row);
            rows.push(row);
            process.stderr.write('\n');
        }
    } finally {
        Math.random = originalRandom;
    }
    const totals = rows.reduce((total, row) => {
        for(const key of ['wins', 'losses', 'other', 'played', 'outcomeEquivalent', 'traceEquivalent', 'candidateMs', 'controlMs',
            ...Object.keys(emptyPlannerMetrics())]) {
            total[key] += row[key];
        }
        return total;
    }, { wins: 0, losses: 0, other: 0, played: 0, outcomeEquivalent: 0, traceEquivalent: 0, candidateMs: 0, controlMs: 0, ...emptyPlannerMetrics() });
    totals.winRate = totals.played ? totals.wins / totals.played : null;
    totals.confidence95 = wilson(totals.wins, totals.played);
    totals.meanCandidateMs = totals.played ? totals.candidateMs / totals.played : 0;
    totals.meanControlMs = totals.played ? totals.controlMs / totals.played : 0;
    finalizePlannerMetrics(totals);
    totals.victoryTypes = rows.reduce((all, row) => {
        for(const [type, count] of Object.entries(row.victoryTypes)) all[type] = (all[type] || 0) + count;
        return all;
    }, {});
    const report = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        configurationId: `${options.candidateEngine}-${options.controlEngine}-seed${options.seed}-${options.mode}-${options.v2Mode}`,
        configurationHash: stableConfigurationHash({
            candidateEngine: options.candidateEngine,
            controlEngine: options.controlEngine,
            strategySeed: options.seed,
            informationMode: options.mode,
            v2Mode: options.v2Mode,
            decks: options.decks,
            games: options.games,
            rngSeed: options.rngSeed
        }),
        config: options,
        decks: rows,
        totals
    };
    fs.mkdirSync(path.dirname(options.outPrefix), { recursive: true });
    fs.writeFileSync(`${options.outPrefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(`${options.outPrefix}.md`, markdown(report));
    process.stdout.write(markdown(report));
    if(options.requireEquivalence &&
        (totals.outcomeEquivalent !== totals.played || totals.traceEquivalent !== totals.played)) {
        process.exitCode = 1;
    }
}

if(require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error.stack || error}\n`);
        process.exit(1);
    });
}

module.exports = { collectPlannerMetrics, firstTraceDifference, markdown, normalizedTrace, parseArgs, seededRandom, wilson };
