'use strict';

// Deterministic paired-game policy debugger. Runs one control game and one
// candidate game with identical deck order, seat order, bot seeds, and Math.random
// stream, then writes a detailed JSON trace plus a compact Markdown comparison.
//
// Usage:
//   node tools/selfplay/analyzePolicyGame.js
//   node tools/selfplay/analyzePolicyGame.js --deck PhoenixShugenja \
//     --control generic --candidate fate-aware --rng-seed 20260715
//   node tools/selfplay/analyzePolicyGame.js --deck Lion --opponent Crane \
//     --candidate fate-aware --challenger-second --out tools/selfplay/out/lion-policy

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

const POLICY_NAMES = new Set(['generic', 'fate-aware', 'board-aware']);

function usage() {
    return [
        'Usage: node tools/selfplay/analyzePolicyGame.js [options]',
        '',
        'Options:',
        '  --deck <label>           Challenger deck (default PhoenixShugenja)',
        '  --opponent <label>       Opponent deck (default Crane)',
        '  --control <policy>       Control policy (default generic)',
        '  --candidate <policy>     Candidate policy (default fate-aware)',
        '  --opponent-policy <name> Opponent policy in both games (default generic)',
        '  --bot-seed <n>           Challenger bot seed (default 1)',
        '  --opponent-seed <n>      Opponent bot seed (default 1)',
        '  --rng-seed <n>           Shared deterministic shuffle seed (default 20260715)',
        '  --challenger-second      Put challenger in second seat in both games',
        '  --max-rounds <n>         Game round cap (default 25)',
        '  --max-game-ms <n>        Per-game wall cap (default 30000)',
        '  --late-round <n>         First round for board target checks (default 3)',
        '  --min-board <n>          Minimum late-round conflict board (default 3)',
        '  --out <path-prefix>      Output prefix; writes .json and .md',
        '  --help                   Show this help',
        '',
        `Deck labels: ${DECK_LABELS.join(', ')}`,
        `Policy names: ${Array.from(POLICY_NAMES).join(', ')}`
    ].join('\n');
}

function parseArgs(argv) {
    const options = {
        deck: 'PhoenixShugenja',
        opponent: 'Crane',
        control: 'generic',
        candidate: 'fate-aware',
        opponentPolicy: 'generic',
        botSeed: 1,
        opponentSeed: 1,
        rngSeed: 20260715,
        challengerSecond: false,
        maxRounds: 25,
        maxGameMs: 30000,
        lateRound: 3,
        minBoard: 3,
        out: null
    };
    const valueFlags = new Map([
        ['--deck', 'deck'],
        ['--opponent', 'opponent'],
        ['--control', 'control'],
        ['--candidate', 'candidate'],
        ['--opponent-policy', 'opponentPolicy'],
        ['--bot-seed', 'botSeed'],
        ['--opponent-seed', 'opponentSeed'],
        ['--rng-seed', 'rngSeed'],
        ['--max-rounds', 'maxRounds'],
        ['--max-game-ms', 'maxGameMs'],
        ['--late-round', 'lateRound'],
        ['--min-board', 'minBoard'],
        ['--out', 'out']
    ]);
    const numeric = new Set(['botSeed', 'opponentSeed', 'rngSeed', 'maxRounds', 'maxGameMs', 'lateRound', 'minBoard']);

    for(let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if(arg === '--challenger-second') {
            options.challengerSecond = true;
            continue;
        }
        const key = valueFlags.get(arg);
        if(!key || i + 1 >= argv.length) {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
        const raw = argv[++i];
        options[key] = numeric.has(key) ? Number(raw) : raw;
    }

    if(!getDeckLoader(options.deck)) {
        throw new Error(`Unknown challenger deck '${options.deck}'`);
    }
    if(!getDeckLoader(options.opponent)) {
        throw new Error(`Unknown opponent deck '${options.opponent}'`);
    }
    if(options.deck === options.opponent) {
        throw new Error('Challenger and opponent deck labels must differ');
    }
    for(const [label, policy] of [['control', options.control], ['candidate', options.candidate], ['opponent', options.opponentPolicy]]) {
        if(!POLICY_NAMES.has(policy)) {
            throw new Error(`Unknown ${label} policy '${policy}'`);
        }
    }
    for(const key of numeric) {
        if(!Number.isFinite(options[key])) {
            throw new Error(`Invalid numeric value for ${key}`);
        }
    }
    return options;
}

// Mulberry32: tiny deterministic generator. Replacing Math.random brackets
// deck construction, shuffle, and game execution so both runs start identically.
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

function compactCard(card) {
    return {
        id: card?.id || null,
        name: card?.name || null,
        uuid: card?.uuid || null,
        type: card?.type || null,
        location: card?.location || null,
        fate: Number(card?.fate) || 0,
        bowed: !!card?.bowed,
        honored: !!card?.isHonored,
        dishonored: !!card?.isDishonored,
        inConflict: !!card?.inConflict,
        military: skill(card, 'military'),
        political: skill(card, 'political'),
        facedown: !!card?.facedown,
        broken: !!card?.isBroken
    };
}

function compactPlayer(player) {
    const board = (player?.cardPiles?.cardsInPlay || []).map(compactCard);
    const characters = board.filter((card) => card.type === 'character');
    const provinceKeys = ['one', 'two', 'three', 'four'];
    const provinces = provinceKeys.flatMap((key) =>
        (player?.provinces?.[key] || []).map((card) => ({ slot: key, ...compactCard(card) })));
    return {
        fate: Number(player?.stats?.fate) || 0,
        honor: Number(player?.stats?.honor) || 0,
        conflictsRemaining: Number(player?.stats?.conflictsRemaining) || 0,
        conflictDeckSize: Number(player?.numConflictCards) || 0,
        handSize: (player?.cardPiles?.hand || []).length,
        hand: (player?.cardPiles?.hand || []).map(compactCard),
        board,
        provinces,
        characters: characters.length,
        readyCharacters: characters.filter((card) => !card.bowed).length,
        persistentCharacters: characters.filter((card) => card.fate > 0).length,
        characterFate: characters.reduce((sum, card) => sum + card.fate, 0),
        military: characters.filter((card) => !card.bowed).reduce((sum, card) => sum + card.military, 0),
        political: characters.filter((card) => !card.bowed).reduce((sum, card) => sum + card.political, 0)
    };
}

function snapshot(game, challengerName, opponentName) {
    try {
        const state = game.getState(challengerName);
        const me = state?.players?.[challengerName];
        const opponent = state?.players?.[opponentName];
        const rings = Object.values(state?.rings || {}).map((ring) => ({
            element: ring?.element || null,
            fate: Number(ring?.fate) || 0,
            claimed: !!ring?.claimed,
            conflictType: ring?.conflictType || null
        }));
        const conflict = state?.conflict ? {
            type: state.conflict.type || state.conflict.conflictType || null,
            element: state.conflict.element || state.conflict.ring?.element || null,
            attackingPlayerId: state.conflict.attackingPlayerId || null,
            attackerSkill: Number(state.conflict.attackerSkill) || 0,
            defenderSkill: Number(state.conflict.defenderSkill) || 0
        } : null;
        return {
            round: Number(game.roundNumber) || 0,
            phase: game.currentPhase || me?.phase || null,
            promptTitle: me?.promptTitle || null,
            menuTitle: me?.menuTitle || null,
            challenger: compactPlayer(me),
            opponent: compactPlayer(opponent),
            rings,
            conflict
        };
    } catch(err) {
        return { error: String(err?.message || err) };
    }
}

function compactDecision(decision) {
    return {
        command: decision?.command || null,
        target: decision?.target || null,
        reason: decision?.reason || null,
        args: decision?.args || []
    };
}

function compactMessage(entry) {
    const message = entry?.message;
    if(Array.isArray(message)) {
        return message.map((part) => typeof part === 'object' ? (part?.name || JSON.stringify(part)) : String(part)).join('');
    }
    if(message?.alert) {
        const alert = message.alert.message;
        return Array.isArray(alert) ? alert.join('') : String(alert);
    }
    return String(message || '');
}

function compactConflict(event) {
    const conflict = event?.conflict || {};
    return {
        round: Number(conflict.game?.roundNumber) || null,
        type: conflict.conflictType || conflict.type || null,
        element: conflict.ring?.element || null,
        attacker: conflict.attackingPlayer?.name || null,
        defender: conflict.defendingPlayer?.name || null,
        winner: conflict.winner?.name || null,
        attackerSkill: Number(conflict.attackerSkill) || 0,
        defenderSkill: Number(conflict.defenderSkill) || 0,
        province: conflict.declaredProvince?.name || null,
        provinceBroken: !!conflict.declaredProvince?.isBroken
    };
}

async function runPolicy(options, policy, runLabel) {
    const originalRandom = Math.random;
    Math.random = seededRandom(options.rngSeed);
    const challengerName = options.deck;
    const opponentName = options.opponent;
    const names = options.challengerSecond
        ? [opponentName, challengerName]
        : [challengerName, opponentName];
    const challengerIndex = names.indexOf(challengerName);
    const opponentIndex = names.indexOf(opponentName);
    const seeds = [];
    const policies = [];
    seeds[challengerIndex] = options.botSeed;
    seeds[opponentIndex] = options.opponentSeed;
    policies[challengerIndex] = policy;
    policies[opponentIndex] = options.opponentPolicy;

    const loadChallenger = getDeckLoader(options.deck);
    const loadOpponent = getDeckLoader(options.opponent);
    const challengerDeck = loadChallenger();
    const opponentDeck = loadOpponent();
    const decks = options.challengerSecond
        ? { deckA: opponentDeck, deckB: challengerDeck }
        : { deckA: challengerDeck, deckB: opponentDeck };
    const decisions = [];
    const conflicts = [];
    const breaks = [];
    let controllers = null;
    let game = null;

    try {
        const result = await runGame({
            names,
            seeds,
            policies,
            ...decks,
            trace: true,
            maxRounds: options.maxRounds,
            maxGameMs: options.maxGameMs,
            onControllers: (list) => {
                controllers = list;
                const controller = list[challengerIndex];
                game = controller.game;
                let beforeCommand = null;
                const runCommand = controller.runCommand.bind(controller);
                const record = controller.record.bind(controller);
                controller.runCommand = (command, playerName, args) => {
                    beforeCommand = snapshot(game, challengerName, opponentName);
                    return runCommand(command, playerName, args);
                };
                controller.record = (prompt, decision, result, reason) => {
                    record(prompt, decision, result, reason);
                    decisions.push({
                        index: decisions.length,
                        accepted: result === 'success',
                        result,
                        traceReason: reason || null,
                        decision: compactDecision(decision),
                        state: beforeCommand || snapshot(game, challengerName, opponentName)
                    });
                    beforeCommand = null;
                };
                game.on('onConflictFinished', (event) => conflicts.push({
                    ...compactConflict(event),
                    round: Number(game.roundNumber) || 0
                }));
                game.on('onBreakProvince', (event) => breaks.push({
                    round: Number(game.roundNumber) || 0,
                    province: event?.card?.name || null,
                    owner: event?.card?.controller?.name || null,
                    location: event?.card?.location || null
                }));
            }
        });
        const controller = controllers?.[challengerIndex];
        return {
            label: runLabel,
            policy,
            result,
            finalState: game ? snapshot(game, challengerName, opponentName) : null,
            decisions,
            conflicts,
            breaks,
            trace: controller?.trace || [],
            messages: (game?.messages || []).map(compactMessage)
        };
    } finally {
        Math.random = originalRandom;
    }
}

function decisionSignature(entry) {
    const decision = entry?.decision || {};
    return `${decision.command || ''}|${decision.reason || ''}|${decision.target || ''}`;
}

function actionSignature(entry) {
    const decision = entry?.decision || {};
    return `${decision.command || ''}|${decision.target || ''}`;
}

function phaseRows(run) {
    const byRound = new Map();
    for(const entry of run.decisions) {
        if(!entry.accepted || !entry.state?.round || !entry.state?.phase) {
            continue;
        }
        const round = entry.state.round;
        if(!byRound.has(round)) {
            byRound.set(round, {});
        }
        const phases = byRound.get(round);
        if(!phases[entry.state.phase]) {
            phases[entry.state.phase] = entry.state;
        }
    }
    return Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]).map(([round, phases]) => ({
        round,
        dynasty: phases.dynasty || null,
        conflict: phases.conflict || null,
        fate: phases.fate || null
    }));
}

function firstDifference(control, candidate, signature) {
    const left = control.decisions.filter((entry) => entry.accepted);
    const right = candidate.decisions.filter((entry) => entry.accepted);
    const length = Math.min(left.length, right.length);
    for(let i = 0; i < length; i++) {
        if(signature(left[i]) !== signature(right[i])) {
            return { index: i, control: left[i], candidate: right[i] };
        }
    }
    return length === left.length && length === right.length
        ? null
        : { index: length, control: left[length] || null, candidate: right[length] || null };
}

function firstActionDivergence(control, candidate) {
    return firstDifference(control, candidate, actionSignature);
}

function additionalFateByPhase(run, phase) {
    return run.decisions
        .filter((entry) => entry.accepted && entry.state?.phase === phase &&
            /additional-fate|character-fate|setup-fate|tower-fate/i.test(entry.decision?.reason || ''))
        .reduce((sum, entry) => sum + (Number(entry.decision?.target) || 0), 0);
}

function selectedRingFate(entry) {
    const target = entry.decision?.target;
    const ring = (entry.state?.rings || []).find((candidate) => candidate.element === target);
    return Number(ring?.fate) || 0;
}

// The fate-aware policy sets pass-after-strong only after the engine reports
// an actual printed play cost of 4+. If the preceding selection called that
// same card cheap, the dynasty cost hint was missing or wrong.
function dynastyPlanDiagnostics(run) {
    const accepted = run.decisions.filter((entry) => entry.accepted);
    const purchases = [];
    for(let i = 0; i < accepted.length; i++) {
        const selection = accepted[i];
        if(!/^fate-aware-play-(cheap|strong)-character$/.test(selection.decision?.reason || '')) {
            continue;
        }
        let additional = null;
        let passReason = null;
        for(let j = i + 1; j < accepted.length; j++) {
            const next = accepted[j];
            if(/^fate-aware-play-(cheap|strong)-character$/.test(next.decision?.reason || '')) {
                break;
            }
            if(next.decision?.reason === 'fate-aware-additional-fate') {
                additional = Number(next.decision.target) || 0;
            }
            if(/^fate-aware-(?:pass|preserve)/.test(next.decision?.reason || '')) {
                passReason = next.decision.reason;
                break;
            }
        }
        purchases.push({
            round: selection.state?.round || null,
            card: selection.decision?.target || null,
            selectedAs: selection.decision.reason.includes('-cheap-') ? 'cheap' : 'strong',
            additionalFate: additional,
            passReason
        });
    }
    const costHintMismatches = purchases.filter((purchase) =>
        purchase.selectedAs === 'cheap' && purchase.passReason === 'fate-aware-pass-after-strong-character');
    const zeroFundedStrong = purchases.filter((purchase) =>
        purchase.passReason === 'fate-aware-pass-after-strong-character' && purchase.additionalFate === 0);
    return { purchases, costHintMismatches, zeroFundedStrong };
}

function reasonHistogram(run) {
    const histogram = {};
    for(const entry of run.decisions) {
        if(entry.accepted && entry.decision?.reason) {
            histogram[entry.decision.reason] = (histogram[entry.decision.reason] || 0) + 1;
        }
    }
    return histogram;
}

function strategicDecisions(run) {
    const important = /^(?:fate-aware-|play-dynasty-character|dynasty-|tadaka-setup-|lion-(?:play|save)|duel-(?:play|save)|attachment-tower-(?:play|save)|additional-fate|declare-conflict-ring)/i;
    return run.decisions.filter((entry) => entry.accepted && important.test(entry.decision?.reason || ''));
}

function summarize(run, options = {}) {
    const accepted = run.decisions.filter((entry) => entry.accepted);
    const rows = phaseRows(run);
    const lateRound = Number(options.lateRound) || 3;
    const minBoard = Number(options.minBoard) || 3;
    const lateConflictRows = rows.filter((row) => row.round >= lateRound && row.conflict);
    const underBoardTarget = lateConflictRows.filter((row) =>
        (Number(row.conflict.challenger?.characters) || 0) < minBoard);
    const dynastyPasses = accepted.filter((entry) =>
        entry.state?.phase === 'dynasty' && /pass|preserve/i.test(entry.decision?.reason || '')).length;
    const ringDeclarations = accepted
        .filter((entry) => /declare-conflict-ring/i.test(entry.decision?.reason || ''));
    const ringChoices = ringDeclarations.map((entry) => entry.decision.target);
    const ringFateTargets = ringDeclarations.filter((entry) => selectedRingFate(entry) > 0);
    const dynastyPlan = dynastyPlanDiagnostics(run);
    const dynastyFates = rows
        .map((row) => Number(row.dynasty?.challenger?.fate))
        .filter((value) => Number.isFinite(value));
    return {
        winner: run.result.winner,
        reason: run.result.winReason,
        rounds: run.result.rounds,
        steps: run.result.steps,
        challengerReward: run.result.reward?.[run.label],
        conflictsWon: run.result.reward?.[run.label]?.counts?.conflictsWon ?? null,
        provincesBroken: run.result.reward?.[run.label]?.counts?.provincesBroken ?? null,
        finalFate: run.finalState?.challenger?.fate ?? null,
        finalHonor: run.finalState?.challenger?.honor ?? null,
        finalCharacters: run.finalState?.challenger?.characters ?? null,
        dynastyAdditionalFate: additionalFateByPhase(run, 'dynasty'),
        conflictAdditionalFate: additionalFateByPhase(run, 'conflict'),
        dynastyPasses,
        ringChoices,
        fateRingChoices: ringFateTargets.length,
        fateRingAvailable: ringDeclarations.filter((entry) =>
            (entry.state?.rings || []).some((ring) => (Number(ring.fate) || 0) > 0)).length,
        fateRingTotal: ringFateTargets.reduce((sum, entry) => sum + selectedRingFate(entry), 0),
        peakDynastyFate: dynastyFates.length > 0 ? Math.max(...dynastyFates) : null,
        lateRound,
        minBoard,
        lateBoardStarts: lateConflictRows.length,
        lateBoardBelowTarget: underBoardTarget.map((row) => row.round),
        lateAverageCharacters: lateConflictRows.length > 0
            ? lateConflictRows.reduce((sum, row) => sum + (Number(row.conflict.challenger?.characters) || 0), 0) / lateConflictRows.length
            : null,
        lateAveragePersistent: lateConflictRows.length > 0
            ? lateConflictRows.reduce((sum, row) => sum + (Number(row.conflict.challenger?.persistentCharacters) || 0), 0) / lateConflictRows.length
            : null,
        unopposedDefenses: run.conflicts.filter((conflict) =>
            conflict.defender === run.label && conflict.defenderSkill === 0).length,
        dynastyPlan,
        reasonHistogram: reasonHistogram(run),
        phaseRows: rows
    };
}

function firstDivergence(control, candidate) {
    return firstDifference(control, candidate, decisionSignature);
}

function cell(value) {
    return value === undefined || value === null ? '-' : String(value).replace(/\|/g, '\\|');
}

function stateCell(state) {
    if(!state) {
        return '-';
    }
    const me = state.challenger;
    return `fate ${me.fate}; chars ${me.characters}; persistent ${me.persistentCharacters}; char-fate ${me.characterFate}; ready-skill ${me.military}/${me.political}`;
}

function decisionLine(entry) {
    if(!entry) {
        return '-';
    }
    const state = entry.state || {};
    const me = state.challenger || {};
    return `R${state.round || '?'} ${state.phase || '?'}: ${entry.decision?.reason || '?'} -> ${entry.decision?.target || '?'} (fate ${me.fate ?? '?'}, chars ${me.characters ?? '?'})`;
}

function markdownReport(options, control, candidate) {
    const controlSummary = summarize(control, options);
    const candidateSummary = summarize(candidate, options);
    const divergence = firstActionDivergence(control, candidate);
    const rowsByPolicy = [
        [options.control, controlSummary],
        [options.candidate, candidateSummary]
    ];
    const lines = [
        `# Policy Game Analysis: ${options.deck} vs ${options.opponent}`,
        '',
        `Deterministic RNG seed: \`${options.rngSeed}\`. Challenger seat: ${options.challengerSecond ? 'second' : 'first'}. Opponent policy: \`${options.opponentPolicy}\`.`,
        '',
        '## Outcome',
        '',
        '| Policy | Winner | Reason | Rounds | Conflicts won | Provinces broken | Final fate | Final characters |',
        '|---|---|---|---:|---:|---:|---:|---:|'
    ];
    for(const [policy, summary] of rowsByPolicy) {
        lines.push(`| ${policy} | ${cell(summary.winner)} | ${cell(summary.reason)} | ${cell(summary.rounds)} | ${cell(summary.conflictsWon)} | ${cell(summary.provincesBroken)} | ${cell(summary.finalFate)} | ${cell(summary.finalCharacters)} |`);
    }

    lines.push('', '## First Challenger-Action Divergence', '');
    if(divergence) {
        lines.push(`Decision index ${divergence.index}:`, '');
        lines.push(`- Control: ${decisionLine(divergence.control)}`);
        lines.push(`- Candidate: ${decisionLine(divergence.candidate)}`);
    } else {
        lines.push('No challenger-action divergence.');
    }

    lines.push('', '## Automatic Diagnostics', '');
    const mismatches = candidateSummary.dynastyPlan.costHintMismatches;
    const zeroFunded = candidateSummary.dynastyPlan.zeroFundedStrong;
    if(mismatches.length > 0) {
        lines.push(`- Cost-hint mismatch: ${mismatches.length} character(s) selected as cheap were later recognized as 4+ cost: ${mismatches.map((purchase) => `R${purchase.round} ${purchase.card}`).join(', ')}.`);
    } else {
        lines.push('- Cost-hint mismatch: none detected.');
    }
    if(zeroFunded.length > 0) {
        lines.push(`- Strong-character funding: ${zeroFunded.length} strong purchase(s) received 0 additional fate: ${zeroFunded.map((purchase) => `R${purchase.round} ${purchase.card}`).join(', ')}.`);
    } else {
        lines.push('- Strong-character funding: every detected strong purchase received additional fate.');
    }
    lines.push(`- Candidate round ${candidateSummary.lateRound}+ board target (${candidateSummary.minBoard}+ characters): missed in ${candidateSummary.lateBoardBelowTarget.length}/${candidateSummary.lateBoardStarts} conflict starts${candidateSummary.lateBoardBelowTarget.length ? ` (rounds ${candidateSummary.lateBoardBelowTarget.join(', ')})` : ''}.`);
    lines.push(`- Candidate late board averages: ${candidateSummary.lateAverageCharacters === null ? '-' : candidateSummary.lateAverageCharacters.toFixed(2)} characters; ${candidateSummary.lateAveragePersistent === null ? '-' : candidateSummary.lateAveragePersistent.toFixed(2)} with fate.`);
    lines.push(`- Candidate peak dynasty-start fate: ${candidateSummary.peakDynastyFate ?? '-'}; unopposed defenses: ${candidateSummary.unopposedDefenses}.`);

    lines.push('', '## Round Economy / Board at Phase Start', '');
    lines.push('| Policy | Round | Dynasty start | Conflict start | Fate start |');
    lines.push('|---|---:|---|---|---|');
    for(const [policy, summary] of rowsByPolicy) {
        for(const row of summary.phaseRows) {
            lines.push(`| ${policy} | ${row.round} | ${stateCell(row.dynasty)} | ${stateCell(row.conflict)} | ${stateCell(row.fate)} |`);
        }
    }

    lines.push('', '## Economy / Ring Totals', '');
    lines.push('| Policy | Dynasty added fate | Conflict added fate | Dynasty passes | Fate-ring targets | Fate targeted | Declared rings |');
    lines.push('|---|---:|---:|---:|---:|---:|---|');
    for(const [policy, summary] of rowsByPolicy) {
        lines.push(`| ${policy} | ${summary.dynastyAdditionalFate} | ${summary.conflictAdditionalFate} | ${summary.dynastyPasses} | ${summary.fateRingChoices}/${summary.fateRingAvailable} | ${summary.fateRingTotal} | ${summary.ringChoices.join(', ') || '-'} |`);
    }

    lines.push('', '## Strategic Challenger Decisions', '');
    for(const run of [control, candidate]) {
        lines.push(`### ${run.policy}`, '');
        const decisions = strategicDecisions(run);
        if(decisions.length === 0) {
            lines.push('- None');
        } else {
            for(const entry of decisions) {
                lines.push(`- ${decisionLine(entry)}`);
            }
        }
        lines.push('');
    }

    lines.push('## Conflict Results', '');
    for(const run of [control, candidate]) {
        lines.push(`### ${run.policy}`, '');
        if(run.conflicts.length === 0) {
            lines.push('- None');
        } else {
            for(const conflict of run.conflicts) {
                lines.push(`- ${conflict.type || '?'} ${conflict.element || '?'}: ${conflict.attacker || '?'} attacked; winner ${conflict.winner || 'none'}; skill ${conflict.attackerSkill}-${conflict.defenderSkill}; province ${conflict.province || '?'}${conflict.provinceBroken ? ' (broken)' : ''}`);
            }
        }
        lines.push('');
    }

    lines.push('Full decision states, board cards, hands, rings, game messages, and histograms are in sibling JSON file.');
    return lines.join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        console.log(usage());
        return;
    }
    const slug = `${options.deck}-vs-${options.opponent}-${options.control}-vs-${options.candidate}`
        .replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    const defaultPrefix = path.join(__dirname, 'out', `${slug}-seed-${options.rngSeed}`);
    const prefix = path.resolve(options.out || defaultPrefix);
    fs.mkdirSync(path.dirname(prefix), { recursive: true });

    process.stderr.write(`control ${options.control}: ${options.deck} vs ${options.opponent}\n`);
    const control = await runPolicy(options, options.control, options.deck);
    process.stderr.write(`candidate ${options.candidate}: ${options.deck} vs ${options.opponent}\n`);
    const candidate = await runPolicy(options, options.candidate, options.deck);
    const payload = {
        generatedAt: new Date().toISOString(),
        options,
        comparison: {
            firstDivergence: firstDivergence(control, candidate),
            firstActionDivergence: firstActionDivergence(control, candidate),
            control: summarize(control, options),
            candidate: summarize(candidate, options)
        },
        runs: { control, candidate }
    };
    const jsonPath = `${prefix}.json`;
    const markdownPath = `${prefix}.md`;
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    fs.writeFileSync(markdownPath, markdownReport(options, control, candidate));

    console.log(`control: winner=${control.result.winner} reason=${control.result.winReason} rounds=${control.result.rounds}`);
    console.log(`candidate: winner=${candidate.result.winner} reason=${candidate.result.winReason} rounds=${candidate.result.rounds}`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`Markdown: ${markdownPath}`);
}

if(require.main === module) {
    main().catch((err) => {
        console.error(err?.stack || err);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    seededRandom,
    runPolicy,
    snapshot,
    summarize,
    firstDivergence,
    firstActionDivergence,
    dynastyPlanDiagnostics,
    markdownReport
};
