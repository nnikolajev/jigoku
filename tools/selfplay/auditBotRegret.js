'use strict';

// Offline V2 trace miner. Findings are deliberately heuristic: they rank
// repeatable investigation targets and carry explicit confidence/limitations;
// they never modify runtime profiles or claim rules-engine counterfactuals.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = [
    'undercommit', 'overcommit', 'missed-terminal', 'unused-impact',
    'duplicate-effect', 'broken-reserve', 'plan-churn', 'threat-estimation'
];

function usage() {
    return `Usage: node tools/selfplay/auditBotRegret.js --input <trace.json> [options]

  --input <path>          JSON trace/report input; repeatable
  --out <prefix>          Write versioned JSON and Markdown reports
  --minimum-cost <n>      Omit lower estimated-cost findings (default 0)
  --replay-limit <n>      Deterministic replay fixtures retained (default 25)`;
}

function parseArgs(argv = []) {
    const options = { inputs: [], out: undefined, minimumCost: 0, replayLimit: 25 };
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') options.help = true;
        else if(arg === '--input') options.inputs.push(path.resolve(argv[++index]));
        else if(arg === '--out') options.out = path.resolve(argv[++index]);
        else if(arg === '--minimum-cost') options.minimumCost = Number(argv[++index]);
        else if(arg === '--replay-limit') options.replayLimit = Number.parseInt(argv[++index], 10);
        else throw new Error(`unknown option ${arg}`);
    }
    if(!options.help && options.inputs.length === 0) throw new Error('at least one --input is required');
    if(!Number.isFinite(options.minimumCost) || options.minimumCost < 0) throw new Error('--minimum-cost must be non-negative');
    if(!Number.isInteger(options.replayLimit) || options.replayLimit < 0) throw new Error('--replay-limit must be a non-negative integer');
    return options;
}

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

function extractTraceEntries(value, result = [], seen = new Set()) {
    if(!value || typeof value !== 'object' || seen.has(value)) return result;
    seen.add(value);
    if(value.planner && (value.command || value.result || value.selectedBy)) result.push(value);
    if(Array.isArray(value)) value.forEach((entry) => extractTraceEntries(entry, result, seen));
    else Object.values(value).forEach((entry) => extractTraceEntries(entry, result, seen));
    return result;
}

function limitationFor(entry) {
    const mode = entry.informationMode || entry.planner?.information?.mode || 'fair';
    const limitations = mode === 'fair'
        ? ['Hidden opponent identities are unavailable; counterfactual threat and response values use recorded fair hypotheses.']
        : ['Known hidden identities are exact, but future legality and sequencing remain projected rather than rules-engine executed.'];
    if(!entry.planner?.replay) limitations.push('The source trace lacks a full research-level planning-state replay fixture.');
    if(!entry.planner?.outcome) limitations.push('No later material-state outcome was attached to this decision.');
    return limitations;
}

function finding(type, entry, decisionIndex, estimatedCost, confidence, evidence) {
    const planner = entry.planner || {};
    return {
        id: `regret:${type}:${stableHash({ decisionIndex, state: planner.stateSignature, evidence })}`,
        type,
        decisionIndex,
        player: entry.player,
        promptTitle: entry.promptTitle,
        stateSignature: planner.stateSignature,
        promptFingerprint: planner.promptFingerprint,
        intentId: planner.intentId,
        estimatedCost: Math.max(0, Number(estimatedCost) || 0),
        confidence: { label: confidence >= 0.8 ? 'high' : confidence >= 0.55 ? 'medium' : 'low', score: confidence },
        limitations: limitationFor(entry),
        evidence,
        replayId: planner.replay ? `replay:${stableHash({ state: planner.stateSignature, decisionIndex })}` : undefined
    };
}

function bestCandidate(planner, predicate = () => true) {
    return [...(planner.candidates || [])].filter(predicate)
        .sort((left, right) => (right.score ?? -Infinity) - (left.score ?? -Infinity) || String(left.id).localeCompare(String(right.id)))[0];
}

function chosenCandidate(planner) {
    return (planner.candidates || []).find((candidate) => candidate.id === planner.chosenCandidateId);
}

function analyzeRegret(entries, options = {}) {
    const minimumCost = options.minimumCost || 0;
    const replayLimit = options.replayLimit ?? 25;
    const findings = [];
    const previousByPlayer = new Map();
    const intentHistoryByPlayer = new Map();
    for(const [decisionIndex, entry] of entries.entries()) {
        const planner = entry.planner;
        if(!planner) continue;
        const chosen = chosenCandidate(planner);
        const best = bestCandidate(planner, (candidate) => !(candidate.vetoes || []).length);
        const chosenScore = chosen?.score ?? 0;
        const gap = best && best.id !== chosen?.id ? Math.max(0, (best.score ?? 0) - chosenScore) : 0;
        const isPass = !chosen || chosen.kind === 'pass' || /pass/i.test(String(entry.target || entry.reason || ''));

        if(isPass && best && (best.tags || []).some((tag) => ['offense', 'defense', 'payoff'].includes(tag)) && gap >= 2) {
            findings.push(finding('undercommit', entry, decisionIndex, gap, 0.72, {
                chosenCandidateId: planner.chosenCandidateId, alternativeCandidateId: best.id, scoreGap: gap
            }));
        }
        const spent = Object.values(chosen?.costs || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
        if(chosen && spent >= 2 && (planner.runnerUpGap ?? Infinity) <= 1) {
            findings.push(finding('overcommit', entry, decisionIndex, spent - Math.max(0, planner.runnerUpGap || 0), 0.6, {
                chosenCandidateId: chosen.id, resourceSpend: spent,
                runnerUpCandidateId: planner.runnerUpCandidateId, runnerUpGap: planner.runnerUpGap
            }));
        }
        if(planner.terminal?.active && ['forced-win', 'avoids-forced-loss'].includes(planner.terminal.status) &&
            planner.chosenCandidateId !== planner.terminal.selectedCandidateId) {
            findings.push(finding('missed-terminal', entry, decisionIndex, Math.max(10, Math.abs(planner.scoreGap || 0)), 0.9, {
                status: planner.terminal.status, selectedCandidateId: planner.terminal.selectedCandidateId,
                chosenCandidateId: planner.chosenCandidateId, fallbackReason: planner.fallbackReason
            }));
        }
        if(entry.selectedBy !== 'v2' && best && (best.effectKinds || []).some((kind) =>
            ['skill', 'bow', 'ready', 'remove', 'ring', 'province'].includes(kind)) && gap >= 3) {
            findings.push(finding('unused-impact', entry, decisionIndex, gap, 0.62, {
                alternativeCandidateId: best.id, effectKinds: best.effectKinds, scoreGap: gap,
                fallbackReason: entry.fallbackReason || planner.fallbackReason
            }));
        }
        for(const candidate of planner.candidates || []) {
            const duplicate = (candidate.vetoes || []).find((veto) =>
                ['duplicate-non-stacking-effect', 'duplicate-effect-target'].includes(veto.code));
            if(duplicate) findings.push(finding('duplicate-effect', entry, decisionIndex, 2, 0.88, {
                candidateId: candidate.id, vetoCode: duplicate.code, reason: duplicate.reason
            }));
            const reserve = (candidate.vetoes || []).find((veto) => /reserve|honor-floor|deck-exhaustion/.test(veto.code));
            if(reserve && candidate.id === planner.chosenCandidateId) findings.push(finding('broken-reserve', entry, decisionIndex, 5, 0.9, {
                candidateId: candidate.id, vetoCode: reserve.code, reason: reserve.reason
            }));
        }
        const playerKey = entry.player || '(unknown)';
        const previous = previousByPlayer.get(playerKey);
        const intentHistory = intentHistoryByPlayer.get(playerKey) || [];
        const explicitChurn = ['opponent-disruption', 'macro-mismatch', 'command-rejected'].includes(planner.intentInvalidation);
        const oscillated = planner.intentId && previous?.planner?.intentId && planner.intentId !== previous.planner.intentId &&
            intentHistory.slice(-4).includes(planner.intentId);
        if(previous && planner.intentId && previous.planner?.intentId && planner.intentId !== previous.planner.intentId &&
            (explicitChurn || oscillated)) {
            findings.push(finding('plan-churn', entry, decisionIndex, 1, 0.65, {
                previousIntentId: previous.planner.intentId, intentId: planner.intentId,
                invalidation: planner.intentInvalidation || 'unexplained'
            }));
        }
        previousByPlayer.set(playerKey, entry);
        intentHistory.push(planner.intentId);
        intentHistoryByPlayer.set(playerKey, intentHistory.slice(-6));
        if((planner.information?.certainty ?? 1) < 0.55 &&
            ['likely-improvement', 'uncertain', 'scoring-gap'].includes(planner.disagreementType)) {
            findings.push(finding('threat-estimation', entry, decisionIndex,
                Math.max(1, Math.abs(planner.scoreGap || 0)), 0.45, {
                    certainty: planner.information.certainty,
                    handHypotheses: planner.information.handHypotheses,
                    responsePackages: planner.information.responsePackages,
                    disagreementType: planner.disagreementType
                }));
        }
    }

    const retained = findings.filter((entry) => entry.estimatedCost >= minimumCost)
        .sort((left, right) => right.estimatedCost - left.estimatedCost || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
    const groups = TYPES.map((type) => {
        const matches = retained.filter((entry) => entry.type === type);
        return {
            type,
            count: matches.length,
            estimatedCost: matches.reduce((sum, entry) => sum + entry.estimatedCost, 0),
            meanConfidence: matches.length ? matches.reduce((sum, entry) => sum + entry.confidence.score, 0) / matches.length : 0
        };
    }).sort((left, right) => right.estimatedCost - left.estimatedCost || right.count - left.count || left.type.localeCompare(right.type));
    const byReplayId = new Map();
    for(const item of retained) {
        const source = entries[item.decisionIndex];
        if(!item.replayId || !source?.planner?.replay || byReplayId.has(item.replayId)) continue;
        byReplayId.set(item.replayId, {
            id: item.replayId,
            findingIds: retained.filter((entry) => entry.replayId === item.replayId).map((entry) => entry.id),
            stateSignature: source.planner.stateSignature,
            promptFingerprint: source.planner.promptFingerprint,
            planningState: source.planner.replay.planningState,
            candidateIds: source.planner.replay.candidateIds,
            configuration: source.planner.replay.configuration,
            v1Action: source.planner.v1Action,
            v2Preference: source.planner.v2Preference
        });
        if(byReplayId.size >= replayLimit) break;
    }
    return {
        schemaVersion: 1,
        findings: retained,
        groups,
        replays: [...byReplayId.values()],
        totals: {
            decisions: entries.length,
            findings: retained.length,
            estimatedCost: retained.reduce((sum, entry) => sum + entry.estimatedCost, 0),
            replayFixtures: byReplayId.size
        }
    };
}

function renderMarkdown(report) {
    const lines = [
        '# V2 regret audit', '',
        `Decisions: ${report.totals.decisions}; findings: ${report.totals.findings}; estimated cost: ${report.totals.estimatedCost.toFixed(1)}; replay fixtures: ${report.totals.replayFixtures}.`, '',
        '## Priorities', '',
        '| Pattern | Findings | Estimated cost | Mean confidence |',
        '| --- | ---: | ---: | ---: |'
    ];
    for(const group of report.groups) {
        lines.push(`| ${group.type} | ${group.count} | ${group.estimatedCost.toFixed(1)} | ${(group.meanConfidence * 100).toFixed(0)}% |`);
    }
    lines.push('', '## Highest-cost findings', '');
    for(const item of report.findings.slice(0, 30)) {
        lines.push(`- ${item.id}: ${item.type}, cost ${item.estimatedCost.toFixed(1)}, ${item.confidence.label} confidence; ${item.promptTitle || item.promptFingerprint || 'unknown prompt'}.`);
    }
    if(report.findings.length === 0) lines.push('- None.');
    lines.push('', 'Findings are prioritization signals, not exact rules-engine counterfactuals. Each JSON finding records its information and model limitations.', '');
    return `${lines.join('\n')}\n`;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) return process.stdout.write(`${usage()}\n`);
    const entries = [];
    for(const input of options.inputs) extractTraceEntries(JSON.parse(fs.readFileSync(input, 'utf8')), entries);
    const report = {
        ...analyzeRegret(entries, options),
        generatedAt: new Date().toISOString(),
        inputs: options.inputs,
        configurationHash: stableHash({ inputs: options.inputs, minimumCost: options.minimumCost, replayLimit: options.replayLimit })
    };
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

module.exports = { TYPES, analyzeRegret, extractTraceEntries, parseArgs, renderMarkdown, stableHash };
