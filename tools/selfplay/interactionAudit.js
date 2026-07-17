'use strict';

// Runtime instrumentation and pure diagnostics for bot interaction loops.
// Kept separate from the CLI so synthetic regression tests can exercise cycle
// detection without booting the game engine.

const crypto = require('crypto');

const VOLATILE_STATE_KEYS = new Set([
    'messages',
    'spectators',
    'clock',
    'clocks',
    'timer',
    'timersettings',
    'timerremaining',
    'timerstartedat',
    'timeleft'
]);

const STRUCTURAL_SKILL_KEYS = new Set([
    'attackerskill',
    'defenderskill',
    'military',
    'militaryskill',
    'militaryskilltotal',
    'political',
    'politicalskill',
    'politicalskilltotal',
    'skill'
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePromptText(value) {
    return String(value || '')
        .replace(/Attacker:\s*-?\d+\s*Defender:\s*-?\d+/gi, 'Attacker: N Defender: N')
        .replace(/(?:military|political)\s+\w+\s+conflict/gi, 'CONFLICT')
        .replace(/\bany (reactions?|interrupts?)\b.*/gi, 'any $1');
}

function stateJson(game, playerName, structural) {
    const state = game.getState(playerName);
    return JSON.stringify({
        round: Number(game.roundNumber) || 0,
        phase: game.currentPhase || state?.phase || null,
        state
    }, (key, value) => {
        const lower = String(key).toLowerCase();
        if(VOLATILE_STATE_KEYS.has(lower)) {
            return undefined;
        }
        if(structural && STRUCTURAL_SKILL_KEYS.has(lower) && (typeof value === 'number' || typeof value === 'string')) {
            return '#skill';
        }
        if(structural && (lower === 'prompttitle' || lower === 'menutitle') && typeof value === 'string') {
            return normalizePromptText(value);
        }
        // Prompt/button UUIDs are regenerated whenever a canceled play reopens
        // its parent window. They are transport identity, not game progress.
        // Card UUIDs are normalized too in the structural view; array contents,
        // card ids, locations and counts still distinguish real card movement.
        if(structural && typeof value === 'string' && UUID_PATTERN.test(value)) {
            return '#uuid';
        }
        return value;
    });
}

function digest(value) {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function captureInteractionState(game, playerName) {
    const state = game.getState(playerName);
    const me = state?.players?.[playerName] || {};
    return {
        exact: digest(stateJson(game, playerName, false)),
        structural: digest(stateJson(game, playerName, true)),
        round: Number(game.roundNumber) || 0,
        phase: game.currentPhase || state?.phase || null,
        promptTitle: me.promptTitle || null,
        menuTitle: me.menuTitle || null
    };
}

function promptKey(prompt) {
    return normalizePromptText(`${prompt?.promptTitle || ''}|${prompt?.menuTitle || ''}`);
}

function actionKey(decision) {
    if(!decision) {
        return 'unsupported';
    }
    return `${decision.command || ''}|${JSON.stringify(decision.args || [])}|${decision.target || ''}`;
}

function semanticActionKey(decision) {
    if(!decision) {
        return 'unsupported';
    }
    // Buttons/prompts can receive a fresh transport UUID when a canceled card
    // play reopens the same semantic choice. Physical cards do not: preserving
    // their UUIDs keeps three same-name characters in a multi-select from being
    // misreported as one card clicked three times.
    const regenerateTransportIdentity = decision.command === 'menuButton' ||
        decision.command === 'menuItemClick' || decision.command === 'ringMenuItemClick';
    const args = JSON.stringify(decision.args || [], (key, value) =>
        regenerateTransportIdentity && typeof value === 'string' && UUID_PATTERN.test(value) ? '#uuid' : value);
    return `${decision.command || ''}|${args}|${decision.target || ''}`;
}

function compactEvent(event) {
    return {
        index: event.index,
        round: event.before?.round || 0,
        phase: event.before?.phase || null,
        promptTitle: event.promptTitle || null,
        menuTitle: event.menuTitle || null,
        command: event.command || null,
        args: event.args || [],
        target: event.target || null,
        reason: event.reason || null,
        result: event.result,
        state: event.before?.structural || null,
        diagnostic: event.diagnostic || undefined
    };
}

function interactionDiagnostic(controller, game, playerName) {
    const state = game.getState(playerName);
    const me = state?.players?.[playerName] || {};
    const visibleSelectable = [];
    const visit = (value) => {
        if(!value || typeof value !== 'object') {
            return;
        }
        if(value.selectable && (value.uuid || value.name || value.location)) {
            visibleSelectable.push({
                uuid: value.uuid || null,
                id: value.id || null,
                name: value.name || null,
                type: value.type || null,
                location: value.location || null,
                controller: value.controller || null
            });
        }
        if(Array.isArray(value)) {
            value.forEach(visit);
        } else {
            Object.values(value).forEach(visit);
        }
    };
    visit(state);
    const player = controller.player;
    let targetHint;
    let promptStep;
    try {
        promptStep = controller.currentPromptStep(player);
        targetHint = controller.currentTargetHint(player);
    } catch{
        promptStep = undefined;
        targetHint = undefined;
    }
    const liveCardsInPlay = player?.cardsInPlay?.toArray?.() || [];
    const conflict = promptStep?.conflict;
    return {
        selectCard: me.selectCard === true,
        selectRing: me.selectRing === true,
        buttons: (me.buttons || []).map((button) => ({ text: button.text, arg: button.arg, disabled: !!button.disabled })),
        visibleSelectable,
        liveSelectableCards: (player?.promptState?.selectableCards || []).map((card) => ({
            uuid: card.uuid || null,
            id: card.id || null,
            name: card.name || null,
            type: card.type || null,
            location: card.location || null,
            controller: card.controller?.name || null
        })),
        liveSelectableRings: (player?.promptState?.selectableRings || []).map((ring) => ring.element),
        liveRingChecks: Object.values(game.rings || {}).map((ring) => {
            let legalNow = null;
            try {
                legalNow = typeof promptStep?.checkRingCondition === 'function'
                    ? promptStep.checkRingCondition(ring)
                    : null;
            } catch{
                legalNow = null;
            }
            return { element: ring.element, conflictType: ring.conflictType, legalNow };
        }),
        liveCardsInPlay: liveCardsInPlay.map((card) => {
            let legalNow = null;
            try {
                legalNow = typeof promptStep?.checkCardCondition === 'function'
                    ? promptStep.checkCardCondition(card)
                    : null;
            } catch{
                legalNow = null;
            }
            return {
                uuid: card.uuid || null,
                id: card.id || null,
                name: card.name || null,
                bowed: !!card.bowed,
                military: Number(card.getMilitarySkill?.()) || 0,
                political: Number(card.getPoliticalSkill?.()) || 0,
                legalNow
            };
        }),
        promptStep: promptStep ? {
            type: promptStep.constructor?.name || null,
            complete: typeof promptStep.isComplete === 'function' ? promptStep.isComplete() : null,
            choosingPlayer: promptStep.choosingPlayer?.name || null,
            selectedCards: (promptStep.selectedCards || []).map((card) => ({
                uuid: card.uuid || null,
                id: card.id || null,
                name: card.name || null,
                controller: card.controller?.name || null
            })),
            automaticFireOnSelect: typeof promptStep.selector?.automaticFireOnSelect === 'function'
                ? promptStep.selector.automaticFireOnSelect(promptStep.context)
                : null,
            reachedLimit: typeof promptStep.selector?.hasReachedLimit === 'function'
                ? promptStep.selector.hasReachedLimit(promptStep.selectedCards || [], promptStep.context)
                : null,
            conflict: conflict ? {
                type: conflict.conflictType || null,
                element: conflict.element || null,
                province: conflict.conflictProvince ? {
                    id: conflict.conflictProvince.id || null,
                    name: conflict.conflictProvince.name || null,
                    location: conflict.conflictProvince.location || null
                } : null,
                attackers: (conflict.attackers || []).map((card) => card.id || card.name || card.uuid)
            } : null
        } : null,
        targetHint: targetHint || null,
        policySignature: controller.policy?.lastSignature || null,
        policyAttempted: Array.from(controller.policy?.attempted || []),
        recentTrace: (controller.trace || []).slice(-5)
    };
}

// Wrap one live controller. No bot behavior changes: wrappers only observe the
// command boundary, trace recorder, and number of decisions made by each tick.
function instrumentController(controller, game, playerName) {
    const events = [];
    const tickBursts = [];
    let beforeCommand = null;

    const originalRunCommand = controller.runCommand.bind(controller);
    controller.runCommand = (command, name, args) => {
        beforeCommand = captureInteractionState(game, playerName);
        return originalRunCommand(command, name, args);
    };

    const originalRecord = controller.record.bind(controller);
    controller.record = (prompt, decision, result, reason) => {
        originalRecord(prompt, decision, result, reason);
        const before = beforeCommand || captureInteractionState(game, playerName);
        beforeCommand = null;
        events.push({
            index: events.length,
            playerName,
            promptTitle: prompt?.promptTitle || null,
            menuTitle: prompt?.menuTitle || null,
            promptKey: promptKey(prompt),
            command: decision?.command || null,
            args: decision?.args || [],
            target: decision?.target || null,
            actionKey: actionKey(decision),
            semanticActionKey: semanticActionKey(decision),
            reason: reason || decision?.reason || null,
            result,
            before,
            afterImmediate: captureInteractionState(game, playerName),
            diagnostic: result === 'unsupported' || result === 'rejected'
                ? interactionDiagnostic(controller, game, playerName)
                : undefined
        });
    };

    const originalTick = controller.tick.bind(controller);
    controller.tick = () => {
        const traceStart = controller.trace.length;
        const eventStart = events.length;
        const startedAt = Date.now();
        const result = originalTick();
        const decisions = events.length - eventStart;
        if(decisions > 0) {
            tickBursts.push({
                index: tickBursts.length,
                decisions,
                traceEntries: controller.trace.length - traceStart,
                elapsedMs: Date.now() - startedAt,
                firstEvent: eventStart,
                lastEvent: events.length - 1
            });
        }
        return result;
    };

    return {
        playerName,
        events,
        tickBursts,
        maxDecisionsPerTick: Number(controller.config?.maxDecisionsPerTick) || 20,
        finish() {
            const finalState = captureInteractionState(game, playerName);
            for(let i = 0; i < events.length; i++) {
                events[i].afterSettled = events[i + 1]?.before || finalState;
            }
            return { events, tickBursts, finalState };
        }
    };
}

function equalSegment(symbols, left, right, length) {
    for(let i = 0; i < length; i++) {
        if(symbols[left + i] !== symbols[right + i]) {
            return false;
        }
    }
    return true;
}

function findPeriodicCycles(events, options = {}) {
    const minRepeats = options.minCycleRepeats || 3;
    const maxPeriod = options.maxCyclePeriod || 8;
    const modes = ['exact', 'structural'];
    const found = [];
    const seen = new Set();

    for(const mode of modes) {
        const symbols = events.map((event) => {
            const action = mode === 'structural' ? (event.semanticActionKey || event.actionKey) : event.actionKey;
            return `${event.before?.[mode] || ''}|${action}|${event.result}`;
        });
        let coveredUntil = 0;
        for(let start = 0; start < symbols.length; start++) {
            if(start < coveredUntil) {
                continue;
            }
            for(let period = 1; period <= maxPeriod; period++) {
                if(start + period * minRepeats > symbols.length) {
                    break;
                }
                let repeats = 1;
                while(start + period * (repeats + 1) <= symbols.length &&
                    equalSegment(symbols, start, start + period * repeats, period)) {
                    repeats++;
                }
                if(repeats < minRepeats) {
                    continue;
                }
                const patternEvents = events.slice(start, start + period);
                const actionPattern = patternEvents
                    .map((event) => event.semanticActionKey || event.actionKey)
                    .join('>');
                const advancingOnly = patternEvents.every((event) => {
                    const target = String(event.target || '').trim().toLowerCase();
                    return event.command === 'menuButton' &&
                        ['pass', 'done', 'pass conflict', 'pass conflict opportunity'].includes(target);
                });
                // A player can receive the same priority prompt several times
                // while the opponent passes nested windows. Three Pass clicks
                // are normal; six on the identical state crosses the controller's
                // own loop threshold and is still reported.
                if(advancingOnly && repeats < Math.max(options.repeatedActionClicks || 5, 6)) {
                    continue;
                }
                const duplicateKey = `${start}|${period}|${actionPattern}`;
                if(seen.has(duplicateKey)) {
                    continue;
                }
                seen.add(duplicateKey);
                found.push({
                    mode,
                    start,
                    period,
                    repeats,
                    clicks: period * repeats,
                    sample: events.slice(start, start + Math.min(period * 2, 12)).map(compactEvent)
                });
                // Keep one minimal-period finding for this contiguous cycle.
                // Without this, a 2-click loop also reports periods 4/6/8 and
                // every shifted start, turning one defect into thousands.
                coveredUntil = start + period * repeats;
                break;
            }
        }
    }
    return found;
}

function findNoProgressRuns(events, threshold = 4) {
    const runs = [];
    let start = null;
    for(let i = 0; i < events.length; i++) {
        const event = events[i];
        const unchanged = event.result === 'success' &&
            event.before?.structural &&
            event.before.structural === event.afterSettled?.structural;
        if(unchanged && start === null) {
            start = i;
        }
        if((!unchanged || i === events.length - 1) && start !== null) {
            const end = unchanged && i === events.length - 1 ? i : i - 1;
            const length = end - start + 1;
            const actions = events.slice(start, end + 1).map((entry) => entry.actionKey);
            // Multi-select prompts often expose selected cards only in private
            // prompt state. Their public fingerprint stays fixed, but every
            // exact card UUID is different. Require an actual repeated click.
            const hasDuplicateAction = new Set(actions).size < actions.length;
            if(length >= threshold && hasDuplicateAction) {
                runs.push({
                    start,
                    length,
                    sample: events.slice(start, Math.min(end + 1, start + 12)).map(compactEvent)
                });
            }
            start = null;
        }
    }
    return runs;
}

function findRepeatedActionRuns(events, threshold = 5) {
    const runs = [];
    let start = 0;
    for(let i = 1; i <= events.length; i++) {
        const same = i < events.length &&
            events[i].actionKey === events[start].actionKey &&
            events[i].promptKey === events[start].promptKey;
        if(same) {
            continue;
        }
        const length = i - start;
        const target = String(events[start]?.target || '').trim().toLowerCase();
        const advancingButton = events[start]?.command === 'menuButton' && ['pass', 'done', 'pass conflict'].includes(target);
        if(length >= threshold && !advancingButton) {
            runs.push({
                start,
                length,
                sample: events.slice(start, Math.min(i, start + 12)).map(compactEvent)
            });
        }
        start = i;
    }
    return runs;
}

function histogram(events, selector) {
    const counts = {};
    for(const event of events) {
        const key = selector(event);
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

function topEntries(counts, limit = 8) {
    return Object.entries(counts)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([key, count]) => ({ key, count }));
}

function analyzeInteractionAudit(instrumentation, options = {}) {
    const events = instrumentation.events || [];
    const tickBursts = instrumentation.tickBursts || [];
    const maxDecisionsPerTick = instrumentation.maxDecisionsPerTick || options.maxDecisionsPerTick || 20;
    const cycles = findPeriodicCycles(events, options);
    const noProgressRuns = findNoProgressRuns(events, options.noProgressClicks || 4);
    const repeatedActionRuns = findRepeatedActionRuns(events, options.repeatedActionClicks || 5);
    const rejected = events.filter((event) => event.result === 'rejected');
    const unsupported = events.filter((event) => event.result === 'unsupported');
    const forcedProgress = events.filter((event) => String(event.reason || '').startsWith('forced-progress'));
    const budgetExhaustions = tickBursts.filter((burst) => burst.decisions >= maxDecisionsPerTick);
    const maxTickClicks = tickBursts.reduce((max, burst) => Math.max(max, burst.decisions), 0);
    const clickCap = options.clickCap || Math.max(20, maxDecisionsPerTick - 5);
    const issues = [];
    const warnings = [];

    if(cycles.length > 0) {
        issues.push(`${cycles.length} periodic interaction cycle(s)`);
    }
    if(noProgressRuns.length > 0) {
        issues.push(`${noProgressRuns.length} repeated no-progress click run(s)`);
    }
    if(repeatedActionRuns.length > 0) {
        issues.push(`${repeatedActionRuns.length} repeated identical interaction run(s)`);
    }
    if(budgetExhaustions.length > 0) {
        issues.push(`${budgetExhaustions.length} decision-budget exhaustion(s)`);
    }
    if(maxTickClicks > clickCap) {
        issues.push(`tick burst ${maxTickClicks} exceeds click cap ${clickCap}`);
    }
    if(forcedProgress.length > 0) {
        issues.push(`${forcedProgress.length} forced-progress recovery click(s)`);
    }
    if(unsupported.length > 0) {
        issues.push(`${unsupported.length} unsupported prompt(s)`);
    }
    const rejectedCap = options.rejectedCap ?? 3;
    if(rejected.length > rejectedCap) {
        issues.push(`${rejected.length} rejected decisions exceed cap ${rejectedCap}`);
    } else if(rejected.length > 0) {
        warnings.push(`${rejected.length} rejected decision(s)`);
    }

    return {
        status: issues.length > 0 ? 'FAIL' : (warnings.length > 0 ? 'WARN' : 'PASS'),
        issues,
        warnings,
        decisions: events.length,
        successful: events.filter((event) => event.result === 'success').length,
        rejected: rejected.length,
        unsupported: unsupported.length,
        forcedProgress: forcedProgress.length,
        cycles,
        noProgressRuns,
        repeatedActionRuns,
        budgetExhaustions,
        maxTickClicks,
        clickCap,
        uniquePrompts: new Set(events.map((event) => event.promptKey)).size,
        uniqueCardsClicked: new Set(events.filter((event) => event.command === 'cardClicked' || event.command === 'facedownCardClicked').map((event) => event.target || JSON.stringify(event.args))).size,
        uniqueRingsClicked: new Set(events.filter((event) => event.command === 'ringClicked' || event.command === 'ringMenuItemClick').map((event) => event.target || JSON.stringify(event.args))).size,
        byCommand: histogram(events, (event) => event.command || 'unsupported'),
        topInteractions: topEntries(histogram(events, (event) => `${event.promptKey} :: ${event.command || 'unsupported'} :: ${event.target || ''}`)),
        rejectedSamples: rejected.slice(0, 10).map(compactEvent),
        unsupportedSamples: unsupported.slice(0, 10).map(compactEvent),
        forcedProgressSamples: forcedProgress.slice(0, 10).map(compactEvent)
    };
}

module.exports = {
    normalizePromptText,
    captureInteractionState,
    semanticActionKey,
    instrumentController,
    findPeriodicCycles,
    findNoProgressRuns,
    findRepeatedActionRuns,
    analyzeInteractionAudit,
    compactEvent
};
