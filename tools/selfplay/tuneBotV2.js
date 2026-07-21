'use strict';

// Bounded offline ranking for already-measured V2 coefficient profiles. This
// tool never edits runtime defaults: it validates coefficient bounds, scores
// broad-league reports, persists reproducible retained profiles, and emits a
// promotion recommendation only after repeated disjoint holdout confirmation.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadPartitions } = require('./v2BenchmarkPartitions.js');

const DEFAULT_PENALTIES = Object.freeze({
    stall: 100,
    runtime: 8,
    fallback: 8,
    matchupVariance: 12,
    severeDeckOutlier: 15,
    budgetExhaustion: 10,
    plannerError: 100
});

function stable(value) {
    if(Array.isArray(value)) return value.map(stable);
    if(value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, stable(value[key])]));
    }
    return value;
}

function stableHash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0, 20);
}

function variance(values) {
    if(values.length < 2) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function summarizeReport(report, thresholds = {}) {
    const totals = report.totals || {};
    const played = Number(totals.played) || 0;
    const decided = (Number(totals.wins) || 0) + (Number(totals.losses) || 0);
    const deckRows = report.decks || report.deckSummaries || [];
    const deckRates = deckRows.map((row) => row.winRate ?? row.overallWinRate ??
        ((Number(row.wins) || 0) + (Number(row.losses) || 0) > 0
            ? (Number(row.wins) || 0) / ((Number(row.wins) || 0) + (Number(row.losses) || 0))
            : null)).filter((rate) => rate !== null && Number.isFinite(rate));
    const severeThreshold = thresholds.severeDeckWinRate ?? 0.35;
    const severeDeckOutliers = deckRates.filter((rate) => rate < severeThreshold).length;
    const controlRuntime = Number(totals.meanControlMs) || 0;
    const candidateRuntime = Number(totals.meanCandidateMs) || 0;
    return {
        configurationHash: report.configurationHash,
        rngSeed: report.config?.rngSeed,
        strategySeed: report.config?.seed ?? report.config?.botSeed,
        informationMode: report.config?.mode ?? (report.config?.omniscient ? 'omniscient' : 'fair'),
        played,
        winRate: decided ? (Number(totals.wins) || 0) / decided : 0,
        stallRate: played ? (Number(totals.other) || 0) / played : 1,
        runtimeRatio: controlRuntime > 0 ? candidateRuntime / controlRuntime : 1,
        fallbackRate: Number.isFinite(totals.fallbackRate) ? totals.fallbackRate : 1,
        matchupVariance: variance(deckRates),
        severeDeckOutliers,
        budgetExhaustions: Number(totals.budgetExhaustions) || 0,
        plannerErrors: Number(totals.plannerErrors) || 0,
        deckRates
    };
}

function aggregateSummaries(summaries, penalties = DEFAULT_PENALTIES) {
    const played = summaries.reduce((sum, report) => sum + report.played, 0);
    const weighted = (key, fallback = 0) => played
        ? summaries.reduce((sum, report) => {
            const value = Number(report[key]);
            return sum + (Number.isFinite(value) ? value : fallback) * report.played;
        }, 0) / played
        : fallback;
    const result = {
        reports: summaries.length,
        played,
        winRate: weighted('winRate'),
        stallRate: weighted('stallRate', 1),
        runtimeRatio: weighted('runtimeRatio', 1),
        fallbackRate: weighted('fallbackRate', 1),
        matchupVariance: weighted('matchupVariance'),
        severeDeckOutliers: summaries.reduce((sum, report) => sum + report.severeDeckOutliers, 0),
        budgetExhaustions: summaries.reduce((sum, report) => sum + report.budgetExhaustions, 0),
        plannerErrors: summaries.reduce((sum, report) => sum + report.plannerErrors, 0),
        rngSeeds: [...new Set(summaries.map((report) => report.rngSeed).filter(Number.isFinite))].sort((a, b) => a - b)
    };
    result.score = (result.winRate - 0.5) * 100 -
        result.stallRate * penalties.stall -
        Math.max(0, result.runtimeRatio - 1) * penalties.runtime -
        result.fallbackRate * penalties.fallback -
        Math.sqrt(result.matchupVariance) * penalties.matchupVariance -
        result.severeDeckOutliers * penalties.severeDeckOutlier -
        result.budgetExhaustions * penalties.budgetExhaustion -
        result.plannerErrors * penalties.plannerError;
    return result;
}

function resolveReports(entries = [], baseDir = process.cwd(), thresholds) {
    return entries.map((entry) => {
        if(typeof entry === 'object') return summarizeReport(entry, thresholds);
        const file = path.resolve(baseDir, entry);
        return summarizeReport(JSON.parse(fs.readFileSync(file, 'utf8')), thresholds);
    });
}

function validateCoefficients(coefficients, parent = {}, bounds = {}) {
    const errors = [];
    const minimum = bounds.minimum ?? 0.5;
    const maximum = bounds.maximum ?? 1.5;
    const maximumDelta = bounds.maximumDeltaFromParent ?? 0.25;
    for(const [name, value] of Object.entries(coefficients || {})) {
        if(!Number.isFinite(value) || value < minimum || value > maximum) {
            errors.push(`${name}=${value} outside [${minimum}, ${maximum}]`);
        }
        const parentValue = parent[name] ?? 1;
        if(Number.isFinite(value) && Math.abs(value - parentValue) > maximumDelta) {
            errors.push(`${name} delta ${Math.abs(value - parentValue)} exceeds ${maximumDelta}`);
        }
    }
    return { valid: errors.length === 0, errors };
}

function holdoutEligibility(holdout, promotion) {
    const reasons = [];
    if(holdout.reports < (promotion.minimumHoldoutRuns || 2)) reasons.push('insufficient-holdout-runs');
    if(holdout.rngSeeds.length < (promotion.minimumDistinctHoldoutRngSeeds || 2)) reasons.push('insufficient-distinct-holdout-rng');
    if(holdout.played < (promotion.minimumDeckGamesPerRun || 1) * Math.max(1, holdout.reports)) reasons.push('insufficient-holdout-games');
    if(holdout.winRate < (promotion.minimumAggregateWinRate ?? 0.5)) reasons.push('aggregate-holdout-regression');
    if(holdout.stallRate > (promotion.maximumStallRate ?? 0)) reasons.push('holdout-stalls');
    if(holdout.plannerErrors > (promotion.maximumPlannerErrors ?? 0)) reasons.push('planner-errors');
    if(holdout.severeDeckOutliers > (promotion.maximumSevereDeckOutliers ?? 0)) reasons.push('severe-deck-outlier');
    return { eligible: reasons.length === 0, reasons };
}

function evaluateCandidate(candidate, manifest, baseDir, partitions) {
    const coefficientValidation = validateCoefficients(candidate.coefficients, manifest.parentProfile?.coefficients, manifest.bounds);
    const penalties = { ...DEFAULT_PENALTIES, ...(manifest.penalties || {}) };
    const trainingReports = resolveReports(candidate.trainingReports, baseDir, manifest.thresholds);
    const holdoutReports = resolveReports(candidate.holdoutReports, baseDir, manifest.thresholds);
    const training = aggregateSummaries(trainingReports, penalties);
    const holdout = aggregateSummaries(holdoutReports, penalties);
    const promotion = holdoutEligibility(holdout, partitions.promotion || {});
    if(Number.isFinite(manifest.parentProfile?.holdoutScore) && holdout.score < manifest.parentProfile.holdoutScore) {
        promotion.eligible = false;
        promotion.reasons.push('parent-holdout-score-regression');
    }
    return {
        id: candidate.id,
        coefficients: candidate.coefficients,
        coefficientValidation,
        configurationHash: stableHash({
            parent: manifest.parentProfile?.id,
            coefficients: candidate.coefficients,
            bounds: manifest.bounds,
            penalties,
            trainingPartition: partitions.training.id,
            holdoutPartition: partitions.holdout.id
        }),
        training,
        holdout,
        rationale: candidate.rationale,
        eligibleForRetention: coefficientValidation.valid && training.reports > 0 && holdout.reports > 0,
        eligibleForDefault: coefficientValidation.valid && promotion.eligible,
        promotionBlockers: [...coefficientValidation.errors, ...promotion.reasons]
    };
}

function buildRetainedProfile(evaluation, manifest, partitions, generatedAt = new Date().toISOString()) {
    if(!evaluation.eligibleForRetention) throw new Error(`profile ${evaluation.id} is not eligible for retention`);
    return {
        schemaVersion: 1,
        id: evaluation.id,
        status: evaluation.eligibleForDefault ? 'holdout-confirmed' : 'experimental',
        generatedAt,
        configurationHash: evaluation.configurationHash,
        coefficients: evaluation.coefficients,
        parentProfile: manifest.parentProfile,
        sourceConfiguration: {
            bounds: manifest.bounds,
            penalties: { ...DEFAULT_PENALTIES, ...(manifest.penalties || {}) },
            trainingPartition: partitions.training,
            holdoutPartition: partitions.holdout
        },
        trainingResults: evaluation.training,
        holdoutResults: evaluation.holdout,
        rationale: evaluation.rationale,
        eligibleForDefault: evaluation.eligibleForDefault,
        promotionBlockers: evaluation.promotionBlockers
    };
}

function parseArgs(argv = []) {
    const options = {};
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--manifest') options.manifest = path.resolve(argv[++index]);
        else if(arg === '--partitions') options.partitions = path.resolve(argv[++index]);
        else if(arg === '--out') options.out = path.resolve(argv[++index]);
        else if(arg === '--retain') options.retain = String(argv[++index]);
        else if(arg === '--profile-dir') options.profileDir = path.resolve(argv[++index]);
        else if(arg === '--recommend-default') options.recommendDefault = true;
        else if(arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`unknown option ${arg}`);
    }
    if(!options.help && !options.manifest) throw new Error('--manifest is required');
    if(options.recommendDefault && !options.retain) throw new Error('--recommend-default requires --retain');
    return options;
}

function renderMarkdown(report) {
    const lines = [
        '# Bot V2 offline tuning', '',
        `Configuration: ${report.configurationHash}. Candidates: ${report.candidates.length}.`, '',
        '| Profile | Training score | Holdout score | Win rate | Stall rate | Runtime ratio | Fallback | Outliers | Default eligible |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
    ];
    for(const candidate of report.candidates) {
        lines.push(`| ${candidate.id} | ${candidate.training.score.toFixed(2)} | ${candidate.holdout.score.toFixed(2)} | ${(candidate.holdout.winRate * 100).toFixed(1)}% | ${(candidate.holdout.stallRate * 100).toFixed(1)}% | ${candidate.holdout.runtimeRatio.toFixed(2)} | ${(candidate.holdout.fallbackRate * 100).toFixed(1)}% | ${candidate.holdout.severeDeckOutliers} | ${candidate.eligibleForDefault ? 'yes' : `no: ${candidate.promotionBlockers.join(', ')}`} |`);
    }
    lines.push('', 'The tool ranks measured profiles only. It never mutates the runtime default; default replacement requires explicit review after the repeated holdout gate passes.', '');
    return `${lines.join('\n')}\n`;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) return process.stdout.write('Usage: node tools/selfplay/tuneBotV2.js --manifest <json> --out <prefix> [--retain <id> --profile-dir <dir>] [--recommend-default]\n');
    const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
    const partitions = loadPartitions(options.partitions);
    const maximumCandidates = manifest.bounds?.maximumCandidates ?? 64;
    if(!Array.isArray(manifest.candidates) || manifest.candidates.length === 0 || manifest.candidates.length > maximumCandidates) {
        throw new Error(`manifest candidates must contain 1..${maximumCandidates} bounded profiles`);
    }
    const baseDir = path.dirname(options.manifest);
    const candidates = manifest.candidates.map((candidate) => evaluateCandidate(candidate, manifest, baseDir, partitions))
        .sort((left, right) => right.holdout.score - left.holdout.score || right.training.score - left.training.score || left.id.localeCompare(right.id));
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        configurationHash: stableHash({ manifest, partitions }),
        parentProfile: manifest.parentProfile,
        partitions: { training: partitions.training.id, holdout: partitions.holdout.id },
        candidates
    };
    if(options.retain) {
        const selected = candidates.find((candidate) => candidate.id === options.retain);
        if(!selected) throw new Error(`unknown retained profile ${options.retain}`);
        if(options.recommendDefault && !selected.eligibleForDefault) {
            throw new Error(`profile ${selected.id} cannot be recommended as default: ${selected.promotionBlockers.join(', ')}`);
        }
        const profile = buildRetainedProfile(selected, manifest, partitions, report.generatedAt);
        const profileDir = options.profileDir || path.join(__dirname, 'profiles');
        fs.mkdirSync(profileDir, { recursive: true });
        const profilePath = path.join(profileDir, `${selected.id}.json`);
        fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
        report.retainedProfile = profilePath;
        report.defaultRecommendation = options.recommendDefault === true;
    }
    const markdown = renderMarkdown(report);
    if(options.out) {
        fs.mkdirSync(path.dirname(options.out), { recursive: true });
        fs.writeFileSync(`${options.out}.json`, `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(`${options.out}.md`, markdown);
    }
    process.stdout.write(markdown);
}

if(require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error.stack || error}\n`);
        process.exit(1);
    });
}

module.exports = {
    DEFAULT_PENALTIES,
    aggregateSummaries,
    buildRetainedProfile,
    evaluateCandidate,
    holdoutEligibility,
    parseArgs,
    renderMarkdown,
    stableHash,
    summarizeReport,
    validateCoefficients
};
