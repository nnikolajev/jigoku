// SHARED (V1 + V2). Lived under `v2/` until 2026-08-13; moved to `shared/`
// once measurement showed V1 imports it at RUNTIME, so it was never
// experimental. Changing it changes the shipping bot — prove any edit
// bit-identical with `tools/selfplay/refactorIdentity.js`.
//
// Shared vocabulary for the context-aware card values.
//
// The per-card models in `CardValueModel` and the duel/dishonor models in
// `DuelValueModel` both need the same primitives — "is this body actually
// contributing", "what has the opponent sunk into it", "what is its glory". They
// live here so the two modules can share them without importing each other.
//

import { getCardModel } from '../DeckAnalysis.js';
import { getPlaybookEntry } from '../CardPlaybook.js';

export interface ValuedAttachment {
    uuid?: string;
    id?: string;
    militaryBonus?: number;
    politicalBonus?: number;
}

/** A holding we control, with what the province behind it is still worth. */
export interface HoldingInPlay {
    id: string;
    strengthBonus: number;
    /** A broken province cannot be broken again, so its strength is spent. */
    provinceBroken: boolean;
}

export interface ValuedCharacter {
    uuid?: string;
    id?: string;
    /** Printed fate cost, for bodies outside play where no live cost exists. */
    printedCost?: number | null;
    inConflict?: boolean;
    bowed?: boolean;
    honored?: boolean;
    dishonored?: boolean;
    glory?: number;
    fate?: number;
    isUnique?: boolean;
    traits?: string[];
    military?: number | null;
    political?: number | null;
    attachments?: ValuedAttachment[];
}

/** A card we can see the identity of — ours always, theirs only when cheating. */
export interface ValuedHandCard {
    id?: string;
    uuid?: string;
    name?: string;
    fate?: number;
}

export interface CardValueContext {
    conflictType: 'military' | 'political';
    amAttacker: boolean;
    activeConflict: boolean;
    honor: number;
    fate: number;
    myCharacters: ValuedCharacter[];
    opponentCharacters: ValuedCharacter[];
    hand: ValuedHandCard[];
    /** Honor we refuse to drop below when a card charges honor. */
    honorFloor?: number;
    /**
     * Exact live printed cost by character uuid. `getCardModel` only carries
     * curated entries, so most bodies have no printed cost there and a
     * cost-gated effect would silently find no legal target without this.
     */
    printedCostByUuid?: Record<string, number>;
    /**
     * Exact live fate cost of every conflict card we can play, by uuid. Duel and
     * follow-up synergy has to know whether the payoff card is actually
     * AFFORDABLE this window, not merely held.
     */
    handCostByUuid?: Record<string, number>;
    /** Revealed honor dials this round. Make an Opening scales off the gap. */
    myBid?: number;
    opponentBid?: number;
    /** Cards we have played this conflict - Void Fist needs 2 before it turns on. */
    cardsPlayed?: number;
    /** Characters that have lost a duel during this conflict. */
    duelLoserUuids?: string[];
    /** Opponent honor, for duel bid modelling and honor-drain pricing. */
    opponentHonor?: number;
    /** Opponent fate. Levy is worth far more once they cannot pay for cards. */
    opponentFate?: number;
    /**
     * The opponent's hand, populated ONLY when the omniscient capability is on.
     * Policy Debate discards a card of our choice out of it, so its value is the
     * best card in there; without this the model falls back to an estimate.
     */
    opponentHand?: ValuedHandCard[];
    opponentHandSize?: number;
    /** Conflicts we may still declare this phase. Drives stay-ready value. */
    conflictsRemaining?: number;
    /** Do we currently hold the Imperial Favor? Censure requires it. */
    haveImperialFavor?: boolean;
    /** Live glory totals for the favor race (ready characters only). */
    myGlory?: number;
    opponentGlory?: number;
    /** The opponent holds an affordable effect that can bow one of ours. */
    opponentCanBow?: boolean;
    /**
     * Characters that ALREADY carry Clarity of Purpose's protection this
     * conflict. A second copy on the same body adds nothing, so these are not
     * candidates -- see `clarityOfPurposeValue`.
     */
    clarityProtectedUuids?: string[];
    /** Our dynasty discard - Cavalry Reserves recruits out of it. */
    dynastyDiscard?: ValuedCharacter[];
    /** Do we control a holding? Siege Warfare requires one. */
    haveHolding?: boolean;
    /** Strength of the province currently under attack. */
    attackedProvinceStrength?: number;
    /** Skill still needed to break (attacking) or to hold (defending). */
    strengthNeeded?: number;
    /** Live skill margin of the current conflict. Path of Man needs 5+. */
    conflictSkillDifference?: number;
    /** Province-strength bonuses of holdings sitting in our dynasty discard. */
    discardHoldingStrengths?: number[];
    /** Province-strength bonus already installed where Rebuild would target. */
    provinceHoldingStrength?: number;
    /**
     * Every holding we control, with the province state that decides what
     * giving it up costs. Kaiu Siege Force bottoms one to ready itself; a bare
     * strength number cannot tell a spent wall from a load-bearing one.
     */
    playHoldings?: HoldingInPlay[];
    /** Importance of the best card Gossip could forbid this phase. */
    bestBlockableThreat?: number;
}

export interface CardValue {
    selfSkill: number;
    opponentSkill: number;
    abilityValue: number;
    honorCost?: number;
    /** True when the card has no useful application right now. */
    blocked?: boolean;
    /**
     * Worth that OUTLIVES this conflict, in planner score units. An attachment's
     * +2 applies to every conflict it survives into, while an event's +3 applies
     * once; scoring only the current conflict made the planner trade attachments
     * for events (measured: 349 of 410 divergences from V1 were this shape).
     * Deliberately NOT skill - it must not change who wins the conflict in front
     * of us.
     */
    persistentValue?: number;
    /**
     * Province strength this card removes from the attacked province. Breaking
     * needs `lead >= strength`, so -2 strength and +2 skill are arithmetically
     * the same thing; keeping it a separate field lets the break math use it
     * without pretending a body got bigger.
     */
    provinceStrengthDelta?: number;
    /**
     * The card IS legal and would do something; it is only below a value
     * threshold this model prefers. Kept distinct from `blocked` because a
     * preference must never become a veto: measured, vetoing Oracle of Stone on
     * "your hand is already live" cost PhoenixShugenja 22pp, since the card also
     * simply cycles. Scorers may treat a hold as zero; gates must not.
     */
    hold?: boolean;
    reason?: string;
}

export const NOTHING: CardValue = {
    selfSkill: 0, opponentSkill: 0, abilityValue: 0, blocked: true, reason: 'no-target'
};

/**
 * One point of PROVINCE STRENGTH in score units.
 *
 * Breaking requires the attacker's lead to reach the province's strength, so a
 * point of strength is worth a point of skill to whoever is defending it — and
 * unlike skill it persists for the whole game, which is why it prices above 1.
 */
export const PROVINCE_STRENGTH_SCORE = 3;

/** No legal or useful application exists: safe to refuse the play outright. */
export function blocked(reason: string): CardValue {
    return { ...NOTHING, reason };
}

/** Legal, but not worth it by this model's threshold. Never a veto. */
export function hold(reason: string): CardValue {
    return { ...NOTHING, hold: true, reason };
}

/**
 * A character only affects the conflict in front of us when it is IN that
 * conflict and still standing. Bowed participants contribute nothing, so
 * removing or buffing them changes no skill total.
 */
export function contributesToConflict(card: ValuedCharacter | undefined): boolean {
    return !!card && !!card.inConflict && !card.bowed;
}

// Skill on one axis, preferring the live summary and falling back to the
// card model. A bowed character still reports its printed skill here —
// callers apply the bowed-contributes-nothing rule themselves.
export function skillOf(card: ValuedCharacter | undefined, type: 'military' | 'political'): number {
    if(!card) {
        return 0;
    }
    const value = type === 'political' ? card.political : card.military;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

/** Live skill this character is actually adding to the conflict right now. */
export function conflictSkillOf(card: ValuedCharacter | undefined, type: 'military' | 'political'): number {
    return contributesToConflict(card) ? skillOf(card, type) : 0;
}

// Glory, from the card model when the serialized state omits it.
export function gloryOf(card: ValuedCharacter | undefined): number {
    const printed = card?.id ? getCardModel(card.id) : undefined;
    const live = Number(card?.glory);
    if(Number.isFinite(live)) {
        return Math.max(0, live);
    }
    // CardModel carries no glory; fall back to 1, the commonest printed value,
    // so an unknown card is still worth something rather than silently zero.
    return printed ? 1 : 0;
}

// Printed cost. The serialized player state does not carry it, so this
// falls back to the card model and then to the context's cost map.
export function printedCost(
    card: { id?: string; uuid?: string; printedCost?: number | null } | undefined,
    ctx?: CardValueContext
): number | undefined {
    const live = card?.uuid ? ctx?.printedCostByUuid?.[card.uuid] : undefined;
    if(Number.isFinite(Number(live))) {
        return Number(live);
    }
    // Published by DrawCard.getSummary(). The live map only covers bodies IN
    // PLAY, so without this every discard-pile card fell back to cost 1 and
    // Cavalry Reserves thought it could recruit six of them for six fate.
    if(Number.isFinite(Number(card?.printedCost))) {
        return Number(card?.printedCost);
    }
    const model = card?.id ? getCardModel(card.id) : undefined;
    return model ? model.fate : undefined;
}

/**
 * Fate this conflict card costs to play, preferring the live number the
 * controller reported over the curated table. Returns undefined when neither
 * knows it, so a caller can refuse to budget rather than guess.
 */
export function handCardCost(card: ValuedHandCard | undefined, ctx?: CardValueContext): number | undefined {
    const live = card?.uuid ? ctx?.handCostByUuid?.[card.uuid] : undefined;
    if(Number.isFinite(Number(live))) {
        return Number(live);
    }
    if(Number.isFinite(Number(card?.fate))) {
        return Number(card?.fate);
    }
    const model = card?.id ? getCardModel(card.id) : undefined;
    return model ? model.fate : undefined;
}

/** Value of the body itself, used when a kill/bow lands outside the conflict. */
export function bodyValue(card: ValuedCharacter, ctx?: CardValueContext): number {
    const cost = printedCost(card, ctx) ?? 1;
    return 3 + cost * 2 + (card.isUnique ? 2 : 0);
}

/**
 * Everything the controller has sunk into this body: printed cost, fate still
 * sitting on it, and the attachments riding it. This is what a hard removal
 * actually destroys, and it is why trading a 1-cost honored body for a
 * fate-loaded tower is a good deal regardless of the current skill totals.
 */
export function investedValue(card: ValuedCharacter, ctx?: CardValueContext): number {
    const cost = printedCost(card, ctx) ?? 1;
    const fate = Math.max(0, Number(card.fate) || 0);
    const attachments = (card.attachments || []).length;
    return cost * 2 + fate * 3 + attachments * 2 + (card.isUnique ? 2 : 0);
}

/** Our best persistent body — the "tower" deck rules are usually protecting. */
export function towerCharacter(
    characters: ValuedCharacter[],
    type: 'military' | 'political'
): ValuedCharacter | undefined {
    return characters.slice().sort((a, b) =>
        (Number(b.fate) || 0) * 3 + skillOf(b, type) - ((Number(a.fate) || 0) * 3 + skillOf(a, type)) ||
        String(a.uuid).localeCompare(String(b.uuid)))[0];
}

// Skill an attachment adds on one axis, direct bonus first then model.
export function attachmentSkill(attachment: ValuedAttachment, type: 'military' | 'political'): number {
    const direct = type === 'political' ? attachment.politicalBonus : attachment.militaryBonus;
    if(Number.isFinite(Number(direct))) {
        return Number(direct);
    }
    const model = attachment.id ? getCardModel(attachment.id) : undefined;
    if(!model) {
        return 0;
    }
    return type === 'political' ? model.polBonus : model.milBonus;
}

/**
 * What it is worth that a character does NOT bow as a result of this conflict.
 *
 * Two distinct payoffs, and the second is the one that is easy to forget:
 *
 *   1. Reuse — a ready body can be declared into, or defend, the conflicts left
 *      in this phase. That is worth its skill again, once per remaining
 *      conflict, discounted because it will not always be the right body.
 *   2. The Imperial Favor — `getContributionToImperialFavor` counts a
 *      character's glory only while it is READY (drawcard.ts). Staying upright
 *      therefore keeps its glory in the favor race, which a bowed body loses.
 *
 * This is why "does not bow" cards are strong even when they change no skill in
 * the conflict being fought.
 */
export function stayReadyValue(
    card: ValuedCharacter | undefined,
    ctx: CardValueContext,
    reuseWeight = 0.6
): number {
    if(!card) {
        return 0;
    }
    const remaining = Math.max(0, Number(ctx.conflictsRemaining) || 0);
    const skill = Math.max(skillOf(card, 'military'), skillOf(card, 'political'));
    // Only the conflicts actually left can reuse it, and a body is rarely the
    // right one for every single one of them.
    const reuse = skill * Math.min(remaining, 2) * reuseWeight;
    // Glory only counts toward the favor while ready, so a contested favor race
    // makes keeping it upright worth more.
    const favorRace = Math.abs((Number(ctx.myGlory) || 0) - (Number(ctx.opponentGlory) || 0)) <= 3;
    const favor = gloryOf(card) * (favorRace ? 1.5 : 0.5);
    return Math.round((reuse + favor) * 10) / 10;
}

/**
 * How many more conflicts this bearer can realistically fight in.
 *
 * Fate is the survival clock: a character loses 1 fate in every fate phase and is
 * discarded once it has none, so a body with N fate lives roughly N more ROUNDS -
 * and each round offers a military and a political conflict. An attachment on a
 * fate-loaded tower therefore outlives the current phase entirely, which is
 * exactly why it beats a one-shot event.
 *
 * Capped: a bearer is rarely the right body for every conflict it survives into,
 * and the bonus dies with it the moment it is removed.
 */
export function bearerLifetimeConflicts(
    bearer: ValuedCharacter | undefined,
    ctx: CardValueContext,
    conflictsPerRound = 2,
    cap = 6
): number {
    const remainingThisPhase = Math.max(0, Number(ctx.conflictsRemaining) || 0);
    const fate = Math.max(0, Number(bearer?.fate) || 0);
    return Math.min(cap, remainingThisPhase + fate * conflictsPerRound);
}

/**
 * Turn a per-conflict skill bonus into its whole-game worth.
 *
 * Applies to DEBUFFS as well as buffs: a debuff sits on the opposing body and
 * keeps subtracting for as long as THAT body survives, so it is priced off the
 * enemy bearer's fate. Pass the likely bearer; with none, only the conflicts left
 * this phase count.
 */
export function persistentSkillValue(
    perConflictBonus: number,
    ctx: CardValueContext,
    bearer?: ValuedCharacter,
    weight = 1
): number {
    const bonus = Math.abs(Number(perConflictBonus) || 0);
    if(bonus <= 0) {
        return 0;
    }
    return Math.round(bonus * bearerLifetimeConflicts(bearer, ctx) * weight * 10) / 10;
}

// Case-insensitive trait test.
export function hasTrait(card: ValuedCharacter, trait: string): boolean {
    return (card.traits || []).some((value) => String(value).toLowerCase() === trait);
}

// Only the characters actually in the conflict.
export function participating(list: ValuedCharacter[]): ValuedCharacter[] {
    return list.filter((card) => !!card.inConflict);
}

/** Strongest live contributor, by the skill actually reaching the conflict. */
export function strongestContributor(
    list: ValuedCharacter[],
    type: 'military' | 'political'
): ValuedCharacter | undefined {
    return list.slice().sort((a, b) =>
        conflictSkillOf(b, type) - conflictSkillOf(a, type) ||
        String(a.uuid).localeCompare(String(b.uuid)))[0];
}

// Card name to the id slug the playbook and card model are keyed by.
export function slugFromCardName(name: string): string {
    return String(name || '').toLowerCase().trim()
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Price the event a cancel would stop, read out of the interrupt window title.
 * Returns null when we have no positive evidence about the event, so the caller
 * can fall back to firing rather than treat it as worthless.
 *
 * A `swing` of 0 counts as NO evidence, not as "harmless". `swing` measures
 * conflict skill only, so every honor, draw and economy event in the pool scores
 * zero while still being well worth a cancel. Reading zero as worthless made the
 * gate refuse 7 of Crane's cancels and cost measured games.
 */
export function incomingEventValue(windowTitle: string): number | null {
    const title = String(windowTitle || '').toLowerCase();
    const words = title.split(/[^a-z0-9’']+/).filter(Boolean);
    let best: number | null = null;
    for(let start = 0; start < words.length; start++) {
        for(let end = Math.min(words.length, start + 6); end > start; end--) {
            const model = getCardModel(slugFromCardName(words.slice(start, end).join(' ')));
            if(model && model.side === 'conflict' && model.swing > 0) {
                best = Math.max(best ?? 0, model.swing);
            }
        }
    }
    return best;
}

/** A character whose printed text carries an optional triggered ability. */
export function hasTriggeredAbility(card: ValuedCharacter): boolean {
    // The playbook is the reliable source for "this body has an Action worth
    // firing"; the DeckAnalysis swing table only covers curated events.
    const entry = card.id ? getPlaybookEntry(card.id) : undefined;
    if(entry?.inPlayAction) {
        return true;
    }
    const model = card.id ? getCardModel(card.id) : undefined;
    return !!model && model.swing > 0;
}

/** Does this id sit in our hand, and can we pay for it right now? */
export function affordableInHand(ctx: CardValueContext, id: string, spent = 0): boolean {
    const card = (ctx.hand || []).find((entry) => entry.id === id);
    if(!card) {
        return false;
    }
    const cost = handCardCost(card, ctx);
    // An unknown cost is treated as affordable rather than dropped: refusing to
    // count a payoff we hold understates synergy more often than it overstates.
    return !Number.isFinite(Number(cost)) || (Number(cost) + spent) <= (Number(ctx.fate) || 0);
}
