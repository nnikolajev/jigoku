'use strict';

// Shared runtime card-coverage helpers. "Click coverage" is intentionally not
// enough: the bot also clicks mulligan cards, attackers, defenders, and effect
// targets. These helpers identify source-card activations and separately track
// whether a deck card was actually available to its controller.

const NON_SOURCE_REASON = /(mulligan|adaptive-discard|discard-leftover|stronghold-province-pick|declare-attacker|declare-defender|chump-block|covert-defender|attack-province|attack-stronghold)/i;
const SOURCE_REASON = /(play|ability|trigger|preconflict|setup|province-conflict-action|dynasty-dig-action|reduce-attachment|tower-removal|prepared-disguise|clarity-urgent)/i;
const NON_FORCED_ABILITY = /(?:^|[.\n>])\s*(?:<b>)?(?!(?:forced\s+)?forced\b)(?:action|reaction|interrupt)(?:<\/b>)?\s*:/i;

function deckEntries(deck) {
    return [
        ...(deck.stronghold || []),
        ...(deck.role || []),
        ...(deck.provinceCards || []),
        ...(deck.dynastyCards || []),
        ...(deck.conflictCards || [])
    ];
}

function expectedPlay(card) {
    return card?.side === 'conflict' ||
        (card?.side === 'dynasty' && (card?.type === 'character' || card?.type === 'event'));
}

function expectedAbility(card) {
    const text = String(card?.text || '')
        .replace(/<i>[\s\S]*?<\/i>/gi, '')
        .replace(/<em>[\s\S]*?<\/em>/gi, '');
    return NON_FORCED_ABILITY.test(text);
}

function activationKind(trace) {
    if(trace?.result !== 'success' || trace?.command !== 'cardClicked' || !trace?.cardId) {
        return null;
    }
    const reason = String(trace.reason || '');
    if(NON_SOURCE_REASON.test(reason) || !SOURCE_REASON.test(reason)) {
        return null;
    }
    const location = String(trace.cardLocation || '').toLowerCase();
    if(location.includes('hand') || location.includes('discard')) {
        return 'play';
    }
    if(location.includes('stronghold') || location === 'role') {
        return 'ability';
    }
    if(location.includes('province')) {
        if(trace.cardType === 'province' || trace.cardSide === 'province' ||
            /(province-conflict-action|trigger-province-ability|ability)/i.test(reason)) {
            return 'ability';
        }
        return trace.cardType === 'holding' ? 'ability' : 'play';
    }
    if(location.includes('play') || trace.cardType === 'province' ||
        trace.cardType === 'stronghold' || trace.cardType === 'role' || trace.cardType === 'holding') {
        return 'ability';
    }
    // Old or synthetic traces can omit location. Play-prefixed decisions are
    // still unambiguous; all other missing-location clicks remain raw only.
    return /play/i.test(reason) ? 'play' : null;
}

function emptyAvailability() {
    return { hand: new Set(), province: new Set(), play: new Set(), selectable: new Set(), sourceSelectable: new Set() };
}

function sourceActionPrompt(game, playerName, statePlayer) {
    const livePrompt = game?.getPlayerByName?.(playerName)?.currentPrompt?.() || {};
    const title = (`${livePrompt.promptTitle || statePlayer?.promptTitle || ''} ` +
        `${livePrompt.menuTitle || statePlayer?.menuTitle || ''}`).toLowerCase();
    if(/mulligan|discard|choose|select|target|attacker|defender|additional fate|pay costs?/.test(title)) {
        return false;
    }
    return /action window|initiate an action|play cards from provinces|reactions?|interrupts?/.test(title);
}

function visitCards(value, callback, seen = new Set()) {
    if(!value || typeof value !== 'object' || seen.has(value)) {
        return;
    }
    seen.add(value);
    if(value.id && (value.uuid || value.type || value.location)) {
        callback(value);
    }
    if(Array.isArray(value)) {
        value.forEach((item) => visitCards(item, callback, seen));
    } else {
        Object.values(value).forEach((item) => visitCards(item, callback, seen));
    }
}

function scanAvailability(game, playerName, deckIds, available) {
    const state = game?.getState?.(playerName);
    const me = state?.players?.[playerName];
    if(!me) {
        return;
    }
    const canChooseSource = sourceActionPrompt(game, playerName, me);
    const scan = (value, zone) => visitCards(value, (card) => {
        if(!deckIds.has(card.id)) {
            return;
        }
        available[zone].add(card.id);
        if(card.selectable) {
            available.selectable.add(card.id);
            if(canChooseSource) available.sourceSelectable.add(card.id);
        }
    });
    scan(me?.cardPiles?.hand, 'hand');
    scan(me?.cardPiles?.cardsInPlay, 'play');
    scan(me?.provinces, 'province');
    scan(me?.strongholdProvince, 'province');
    scan(me?.stronghold, 'play');
    scan(me?.role, 'play');

    // Reactions/events playable from a discard pile are not generally
    // available. Count only cards the engine marked selectable there.
    for(const pile of [me?.cardPiles?.conflictDiscardPile, me?.cardPiles?.dynastyDiscardPile]) {
        visitCards(pile, (card) => {
            if(deckIds.has(card.id) && card.selectable) {
                available.selectable.add(card.id);
                if(canChooseSource) available.sourceSelectable.add(card.id);
            }
        });
    }
}

function addCount(record, key, amount = 1) {
    record[key] = (record[key] || 0) + amount;
}

function summarizeTrace(trace, deckIds) {
    const clicks = {};
    const plays = {};
    const abilities = {};
    const reasons = {};
    for(const entry of trace || []) {
        if(entry.result !== 'success' || entry.command !== 'cardClicked' || !deckIds.has(entry.cardId)) {
            continue;
        }
        addCount(clicks, entry.cardId);
        const byReason = reasons[entry.cardId] || (reasons[entry.cardId] = {});
        addCount(byReason, entry.reason || 'unknown');
        const kind = activationKind(entry);
        if(kind === 'play') {
            addCount(plays, entry.cardId);
        } else if(kind === 'ability') {
            addCount(abilities, entry.cardId);
        }
    }
    return { clicks, plays, abilities, reasons };
}

function emptySemanticStages() {
    return {
        visible: {}, selectable: {}, eligible: {}, candidate: {}, chosen: {}, resolved: {}, payoffRealized: {}
    };
}

function summarizeSemanticTrace(trace, deckIds) {
    const stages = emptySemanticStages();
    for(const entry of trace || []) {
        for(const candidate of entry?.planner?.candidates || []) {
            if(candidate.cardId && deckIds.has(candidate.cardId)) {
                addCount(stages.candidate, candidate.cardId);
            }
        }
        const chosenCardId = entry?.selectedBy === 'v2' ? entry?.planner?.v2Preference?.cardId : undefined;
        if(chosenCardId && deckIds.has(chosenCardId)) {
            addCount(stages.chosen, chosenCardId);
        }
        const kind = activationKind(entry);
        if(kind && deckIds.has(entry.cardId)) {
            addCount(stages.resolved, entry.cardId);
            if(entry?.planner?.outcome?.status === 'realized') {
                addCount(stages.payoffRealized, entry.cardId);
            }
        }
    }
    return stages;
}

module.exports = {
    activationKind,
    deckEntries,
    emptySemanticStages,
    emptyAvailability,
    expectedAbility,
    expectedPlay,
    scanAvailability,
    summarizeSemanticTrace,
    summarizeTrace,
    visitCards
};
