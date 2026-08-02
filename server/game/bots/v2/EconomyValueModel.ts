// Economy, tempo and resource-denial values for Bot V2.
//
// These nine cards had no value signal at all — no model, no curated `swing`, no
// `conflictContribution` — so any planner saw `null` and skipped them. They are
// not conflict-skill cards; they trade in fate, honor, bodies and province
// strength, which is why the skill-shaped models did not cover them.
//
// Six are REACTIONS, and their trigger already tells them to fire — the only
// question is whether the payoff is worth the card. Three are Actions with a real
// choice to price: Levy (which resource to drain), Rebuild (which holding to
// install) and Gossip (which card to forbid).
//
// V2 ONLY. V1 stays frozen as the measurement control.

import { blocked, hold, printedCost, PROVINCE_STRENGTH_SCORE, skillOf } from './CardValueTypes.js';
import type { CardValue, CardValueContext } from './CardValueTypes';

/**
 * One fate in planner score units.
 *
 * The planner charges `fateWeight` (1.5) per fate spent, so a card that GIVES
 * fate has to be credited on the same scale or gaining fate would look free.
 */
export const FATE_SCORE = 1.5;

/** One honor in score units. Cheaper than fate until the totals get dangerous. */
export const HONOR_SCORE = 1;

// ---------------------------------------------------------------------------
// Free reactions — the trigger is the decision
// ---------------------------------------------------------------------------

/**
 * Fruitful Respite — after the opponent PASSES on declaring a conflict, if they
 * still control a ready character, gain 2 fate. Costs nothing.
 *
 * There is nothing to weigh: it is two free fate on a trigger we do not control.
 * Always fire.
 */
export function fruitfulRespiteValue(): CardValue {
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: 2 * FATE_SCORE,
        reason: 'free-2-fate'
    };
}

/**
 * Spoils of War — after winning a military conflict as the ATTACKER, draw 3 and
 * discard 1. Free, once per conflict.
 *
 * A net two cards for nothing, and the discard is ours to choose, so the worst
 * case is discarding the card we least want. Always fire.
 */
export function spoilsOfWarValue(): CardValue {
    return {
        selfSkill: 0,
        opponentSkill: 0,
        // Two net cards. Priced against `cardWeight`, the planner's own cost per
        // card played, so drawing and spending stay on one scale.
        abilityValue: 2 * 2,
        reason: 'draw-3-discard-1'
    };
}

/**
 * The Path of Man — after winning a conflict by 5 or more skill, gain 2 fate.
 *
 * The reaction itself is free and unconditional once the margin exists, so it
 * always fires. What it really rewards is OVERCOMMITTING to reach a margin of 5,
 * which is a declaration/spend decision rather than a card play — `marginNeeded`
 * lets a caller ask "is closing the gap worth 2 fate" on the same scale.
 */
export function thePathOfManValue(ctx: CardValueContext, skillDifference = 0): CardValue {
    if(skillDifference >= 5) {
        return {
            selfSkill: 0, opponentSkill: 0,
            abilityValue: 2 * FATE_SCORE,
            reason: 'margin-' + skillDifference + '-gain-2-fate'
        };
    }
    // Not there yet: report what the payoff would be worth so a spend decision
    // can be compared against the cost of the extra skill.
    return hold('margin-' + skillDifference + '-needs-' + (5 - skillDifference));
}

/**
 * Guardians of Rokugan — after winning a conflict as the DEFENDER, look at the
 * top `skillDifference` cards of the dynasty deck and put a character costing at
 * most `skillDifference` into play.
 *
 * The win MARGIN is the whole card: it sets both how deep we dig and how big a
 * body we may take. A 1-point defensive win finds a 1-cost body; a 6-point win
 * finds a real threat. Worth its skill across the conflicts still to come, plus
 * its glory in the Imperial Favor race.
 */
export function guardiansOfRokuganValue(ctx: CardValueContext, skillDifference = 0): CardValue {
    const margin = Math.max(0, Number(skillDifference) || 0);
    if(margin <= 0) {
        return blocked('no-win-margin');
    }
    const remaining = Math.max(0, Number(ctx.conflictsRemaining) || 0);
    // A body arriving with no conflicts left still contributes glory to the
    // favor, but nothing to a conflict.
    const expectedSkill = Math.min(margin, 4);
    const useNow = remaining > 0 ? expectedSkill : 0;
    const favorRace = Math.abs((Number(ctx.myGlory) || 0) - (Number(ctx.opponentGlory) || 0)) <= 3;
    return {
        selfSkill: 0,
        opponentSkill: 0,
        // A permanent body is worth more than one conflict of its skill.
        abilityValue: Math.round((useNow * 1.5 + margin + (favorRace ? 2 : 0)) * 10) / 10,
        reason: 'margin-' + margin + '-body' + (remaining > 0 ? '' : '+favor-only')
    };
}

/**
 * For Greater Glory — 1 fate. After we BREAK a province in a military conflict we
 * are attacking, put a fate on each of our Bushi in that conflict.
 *
 * Fate on a body is a round of extra life, so this is worth one fate per Bushi
 * for one fate total: with a Bushi swarm it is close to free value, which is why
 * Lion always wants it.
 */
export function forGreaterGloryValue(ctx: CardValueContext): CardValue {
    const bushi = ctx.myCharacters.filter((card) =>
        !!card.inConflict && (card.traits || []).some((t) => String(t).toLowerCase() === 'bushi'));
    if(bushi.length === 0) {
        return blocked('no-participating-bushi');
    }
    if((Number(ctx.fate) || 0) < 1) {
        return blocked('cannot-pay-1-fate');
    }
    // Each fate placed buys that body another round; net of the 1 fate paid.
    const gained = bushi.length * FATE_SCORE - FATE_SCORE;
    if(gained <= 0) {
        return hold('one-bushi-breaks-even');
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: Math.round(gained * 10) / 10,
        reason: 'fate-on-' + bushi.length + '-bushi'
    };
}

/**
 * Feeding an Army — as the conflict phase begins, BREAK one of our own faceup
 * provinces to put a fate on every character we control with printed cost 3 or
 * lower.
 *
 * A real trade: a province for a round of life on the cheap half of the board. It
 * pays only with a wide board of small bodies, and the province is a quarter of
 * our defeat condition, so it is priced explicitly against `provinceCost`.
 */
export function feedingAnArmyValue(ctx: CardValueContext, provinceCost = 12): CardValue {
    const cheap = ctx.myCharacters.filter((card) => (printedCost(card, ctx) ?? 99) <= 3);
    if(cheap.length === 0) {
        return blocked('no-cost-3-or-lower-characters');
    }
    const kept = cheap.reduce((total, card) =>
        total + FATE_SCORE + Math.max(skillOf(card, 'military'), skillOf(card, 'political')) * 0.25, 0);
    if(kept <= provinceCost) {
        return hold('only-' + cheap.length + '-bodies-worth-' + Math.round(kept));
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: Math.round((kept - provinceCost) * 10) / 10,
        reason: 'preserve-' + cheap.length + '-bodies'
    };
}

// ---------------------------------------------------------------------------
// Actions with a real choice
// ---------------------------------------------------------------------------

/**
 * Levy — the OPPONENT chooses: give us 1 fate or 1 honor.
 *
 * Because they choose, we get whichever they mind least, so the card is priced at
 * the CHEAPER of the two drains — except when one is already empty, which forces
 * the other. Its worth climbs as their totals fall: taking their last fate stops
 * them playing anything, and taking honor matters most when honor loss can end
 * the game. That is why a dishonor deck with honor control values it highly.
 */
export function levyValue(ctx: CardValueContext, dishonorThreshold = 6): CardValue {
    const fate = Math.max(0, Number(ctx.opponentFate) || 0);
    const honor = Math.max(0, Number(ctx.opponentHonor) || 0);

    // Denying the last fate locks them out of paying for cards this window.
    const fateWorth = fate <= 1 ? 8 : fate <= 3 ? 4 : FATE_SCORE;
    // Honor is a defeat condition; the closer to 0, the more a single point is.
    const honorWorth = honor <= 2 ? 20 : honor <= dishonorThreshold ? 8 : HONOR_SCORE;

    // They pick, so assume the cheaper for them — unless a resource is empty, in
    // which case the other one is forced.
    const worth = fate === 0 ? honorWorth : honor === 0 ? fateWorth : Math.min(fateWorth, honorWorth);
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: worth,
        reason: 'drain(fate' + fate + '/honor' + honor + ')'
    };
}

/** Province-strength bonus a holding contributes, by card id. */
export type HoldingStrength = Record<string, number>;

/**
 * Rebuild — shuffle a card out of one of our UNBROKEN provinces, then install a
 * holding from the dynasty discard into that province.
 *
 * For a wall deck the holding's province-strength bonus is the whole point: it
 * raises the threshold an attacker must clear, which is the same break arithmetic
 * from the other side. So the value is the strength we GAIN — the best holding in
 * the discard less whatever sits there now — and it must target an unbroken
 * province, because cards in a broken one are discarded anyway.
 */
export function rebuildValue(
    ctx: CardValueContext,
    discardHoldingStrengths: number[] = [],
    currentProvinceStrengthBonus = 0
): CardValue {
    if(discardHoldingStrengths.length === 0) {
        return blocked('no-holding-in-discard');
    }
    const best = Math.max(...discardHoldingStrengths.map((value) => Number(value) || 0));
    const gain = best - Math.max(0, Number(currentProvinceStrengthBonus) || 0);
    if(gain <= 0) {
        return hold('no-stronger-holding(best' + best + '-vs-' + currentProvinceStrengthBonus + ')');
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        // Province strength is break arithmetic: +1 strength is as good as +1
        // skill to the defender, and it persists for the rest of the game.
        abilityValue: gain * PROVINCE_STRENGTH_SCORE,
        reason: 'install-holding+' + gain + '-strength'
    };
}

/**
 * Gossip — name a card; the opponent cannot play copies of it from hand for the
 * rest of the phase.
 *
 * Only worth a card during the CONFLICT phase, and only against a real threat, so
 * it is priced at the importance of the best card we can forbid. `CraneBaseline-
 * Tactics.pickGossipCard` already chooses the name from the opponent's public
 * deck list (and their hand when the omniscient capability is on); this only
 * decides whether the card is worth spending.
 */
export function gossipValue(
    ctx: CardValueContext,
    bestBlockableThreat = 0,
    threshold = 13
): CardValue {
    if(!ctx.activeConflict) {
        return hold('conflict-phase-only');
    }
    const threat = Math.max(0, Number(bestBlockableThreat) || 0);
    if(threat < threshold) {
        return hold('best-threat-' + threat + '-below-' + threshold);
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: threat,
        reason: 'forbid-threat-' + threat
    };
}
