// SHARED (V1 + V2). Lived under `v2/` until 2026-08-13; moved to `shared/`
// once measurement showed V1 imports it at RUNTIME, so it was never
// experimental. Changing it changes the shipping bot — prove any edit
// bit-identical with `tools/selfplay/refactorIdentity.js`.
//
// Protection, reinforcement and siege values, shared by Bot V1 and Bot V2.
//
// Three effects that are not skill and are easy to underprice:
//
//   - "does not bow as a result of this conflict" — priced by `stayReadyValue`,
//     because the body can then fight the next conflict AND keeps its glory in
//     the Imperial Favor race.
//   - putting a body into a conflict already in progress — worth exactly the
//     skill it brings, which the declaration math never saw coming.
//   - reducing the attacked province's strength — arithmetically the same as
//     adding that much skill, so it is reported as `provinceStrengthDelta` and
//     the break math treats the two identically.
//

import {
    blocked,
    conflictSkillOf,
    gloryOf,
    hasTrait,
    hold,
    participating,
    printedCost,
    skillOf,
    stayReadyValue
} from './CardValueTypes.js';
import type { CardValue, CardValueContext, ValuedCharacter } from './CardValueTypes';
import { duelCardsInHand } from './DuelValueModel.js';

// ---------------------------------------------------------------------------
// Cancels
// ---------------------------------------------------------------------------

/**
 * Censure — cancel any event, but only while we hold the Imperial Favor.
 *
 * Same economics as every other cancel in the pool (see the measured table in
 * docs/bot-v2-deck-tuning.md): the card is free and worth nothing unplayed, so
 * the only real gate is legality — do we actually hold the favor.
 */
export function censureValue(ctx: CardValueContext, incomingValue = 0, threshold = 0): CardValue {
    if(!ctx.haveImperialFavor) {
        return blocked('no-imperial-favor');
    }
    if(incomingValue < threshold) {
        return hold('incoming-below-threshold');
    }
    return { selfSkill: 0, opponentSkill: 0, abilityValue: Math.max(1, incomingValue), reason: 'censure-cancel' };
}

/**
 * Forgery — cancel an event, but only while we are LESS honorable than the
 * player initiating it. Costs 1 fate, unlike the free cancels.
 *
 * The honor comparison is a live board fact, not a preference, so failing it is
 * a hard block: the interrupt simply will not be offered.
 */
export function forgeryValue(ctx: CardValueContext, incomingValue = 0, threshold = 0): CardValue {
    const mine = Number(ctx.honor) || 0;
    const theirs = Number(ctx.opponentHonor) || 0;
    if(mine >= theirs) {
        return blocked('not-less-honorable');
    }
    if((Number(ctx.fate) || 0) < 1) {
        return blocked('cannot-pay-1-fate');
    }
    if(incomingValue < threshold) {
        return hold('incoming-below-threshold');
    }
    return { selfSkill: 0, opponentSkill: 0, abilityValue: Math.max(1, incomingValue), reason: 'forgery-cancel' };
}

/**
 * Duty — cancel an effect that would take our LAST honor, then gain 1.
 *
 * This is not a value decision. The trigger condition is "you are about to lose
 * the game", so the card is worth the game itself and must never be held for
 * something better. Scorpion runs it precisely because its whole plan is living
 * at low honor.
 */
export function dutyValue(ctx: CardValueContext, honorLoss = 0): CardValue {
    const honor = Number(ctx.honor) || 0;
    if(honorLoss > 0 && honorLoss < honor) {
        return blocked('not-lethal');
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        // Deliberately enormous: nothing this card could be saved for outranks
        // not losing the game on the spot.
        abilityValue: 1000,
        reason: 'prevent-honor-loss'
    };
}

// ---------------------------------------------------------------------------
// "Does not bow"
// ---------------------------------------------------------------------------

/** The body we would most like to keep upright: biggest, most reusable. */
function bestStayReadyTarget(
    candidates: ValuedCharacter[],
    ctx: CardValueContext
): ValuedCharacter | undefined {
    return candidates.slice().sort((a, b) =>
        stayReadyValue(b, ctx) - stayReadyValue(a, ctx) ||
        skillOf(b, ctx.conflictType) - skillOf(a, ctx.conflictType) ||
        String(a.uuid).localeCompare(String(b.uuid)))[0];
}

/**
 * Clarity of Purpose — the chosen character of ours cannot be bowed by the
 * opponent's card effects, and in a POLITICAL conflict it also does not bow as
 * a result of the conflict's resolution.
 *
 * The resolution clause is the whole card. Bow protection alone is worth
 * something only when the opponent actually holds a bow effect; not bowing at
 * the end of a political conflict is worth a whole extra conflict of use plus
 * the character's glory in the favor race, every single time.
 */
export function clarityOfPurposeValue(ctx: CardValueContext): CardValue {
    if(!ctx.activeConflict) {
        return blocked('not-during-conflict');
    }
    // The engine targets any character we control, participating or not, but
    // only a participant can bow from resolution or be bowed in the conflict.
    const candidates = participating(ctx.myCharacters).filter((card) => !card.bowed);
    if(candidates.length === 0) {
        return blocked('no-standing-participant');
    }
    const target = bestStayReadyTarget(candidates, ctx);
    const political = ctx.conflictType === 'political';
    const ready = political ? stayReadyValue(target, ctx) : 0;
    // Bow protection is worth the skill it saves, but only against an opponent
    // who can actually use it.
    const protection = ctx.opponentCanBow ? conflictSkillOf(target, ctx.conflictType) * 0.5 : 0;
    const total = ready + protection;
    if(total <= 0) {
        return hold(political ? 'nothing-to-protect' : 'military-no-resolution-clause');
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: Math.round(total * 10) / 10,
        reason: 'clarity:' + target?.id + (political ? '+stays-ready' : '') + (protection > 0 ? '+bow-proof' : '')
    };
}

/**
 * Kakita's Final Stance — military only. The chosen participant cannot be bowed
 * by the opponent's card effects, and does not bow at resolution IF it was
 * involved in a duel during this conflict.
 *
 * So the resolution clause is conditional on a duel actually happening, which
 * makes this a duel-deck card: it is worth its full stay-ready value when a duel
 * has already resolved or we still hold a duel to start, and only bow protection
 * otherwise.
 */
export function kakitasFinalStanceValue(ctx: CardValueContext): CardValue {
    if(ctx.conflictType !== 'military') {
        return blocked('military-only');
    }
    if(!ctx.activeConflict) {
        return blocked('not-during-conflict');
    }
    const candidates = participating(ctx.myCharacters).filter((card) => !card.bowed);
    if(candidates.length === 0) {
        return blocked('no-standing-participant');
    }
    const target = bestStayReadyTarget(candidates, ctx);
    // A duel already fought this conflict is certain; one still in hand is a
    // plan. Both unlock the clause, so both count, the second less.
    const duelHappened = (ctx.duelLoserUuids || []).length > 0;
    const duelAvailable = duelCardsInHand(ctx).length > 0;
    const ready = duelHappened ? stayReadyValue(target, ctx)
        : duelAvailable ? stayReadyValue(target, ctx) * 0.5 : 0;
    const protection = ctx.opponentCanBow ? conflictSkillOf(target, ctx.conflictType) * 0.5 : 0;
    const total = ready + protection;
    if(total <= 0) {
        return hold('no-duel-and-nothing-to-protect');
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: Math.round(total * 10) / 10,
        reason: 'final-stance:' + target?.id + (duelHappened ? '+dueled' : duelAvailable ? '+duel-in-hand' : '')
    };
}

/**
 * The Mountain Does Not Fall — the chosen character does not bow while
 * DEFENDING, for the rest of the phase. Once per round.
 *
 * Defending is the condition, so this is worth nothing on our own attack. The
 * phase-long duration is real value: it covers every defense left this phase,
 * not just this conflict.
 */
export function theMountainDoesNotFallValue(ctx: CardValueContext): CardValue {
    if(ctx.amAttacker) {
        return hold('defenders-only');
    }
    const candidates = participating(ctx.myCharacters).filter((card) => !card.bowed);
    if(candidates.length === 0) {
        return blocked('no-standing-defender');
    }
    const target = bestStayReadyTarget(candidates, ctx);
    const value = stayReadyValue(target, ctx);
    if(value <= 0) {
        return hold('nothing-to-keep-ready');
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: Math.round(value * 10) / 10,
        reason: 'mountain:' + target?.id
    };
}

// ---------------------------------------------------------------------------
// Reinforcement
// ---------------------------------------------------------------------------

/**
 * Raise the Alarm — while DEFENDING a military conflict, flip the facedown
 * dynasty card in the conflict province faceup; if it is a character, put it
 * into the conflict.
 *
 * The card is face down, so its skill is unknown unless we are cheating. Price
 * it at the expected body rather than refusing to value it: the flip itself is
 * also economy, because that province card becomes buyable.
 */
export function raiseTheAlarmValue(ctx: CardValueContext, expectedBodySkill = 2.5): CardValue {
    if(ctx.conflictType !== 'military') {
        return blocked('military-only');
    }
    if(ctx.amAttacker) {
        return blocked('defenders-only');
    }
    if(!ctx.activeConflict) {
        return blocked('not-during-conflict');
    }
    return {
        // Expected, not certain: the province card may not even be a character.
        selfSkill: Math.round(expectedBodySkill * 10) / 10,
        opponentSkill: 0,
        // Flipping the province card faceup is worth something on its own.
        abilityValue: 2,
        reason: 'raise-alarm:expected-' + expectedBodySkill
    };
}

/**
 * Cavalry Reserves — during a military conflict, put Cavalry characters from
 * our dynasty DISCARD into the conflict, up to 6 total printed cost.
 *
 * Worth exactly the military skill it drags back onto the board, so the whole
 * job is picking the best affordable set under the cost-6 cap.
 */
export function cavalryReservesValue(ctx: CardValueContext, costCap = 6): CardValue {
    if(ctx.conflictType !== 'military') {
        return blocked('military-only');
    }
    if(!ctx.activeConflict) {
        return blocked('not-during-conflict');
    }
    const pool = (ctx.dynastyDiscard || []).filter((card) => hasTrait(card, 'cavalry'));
    if(pool.length === 0) {
        return blocked('no-cavalry-in-discard');
    }
    // Greedy by skill per fate: the cap is small and the pool is short, so this
    // is both good enough and stable.
    const ranked = pool.slice().sort((a, b) => {
        const rate = (card: ValuedCharacter) =>
            skillOf(card, 'military') / Math.max(1, printedCost(card, ctx) ?? 1);
        return rate(b) - rate(a) || skillOf(b, 'military') - skillOf(a, 'military') ||
            String(a.uuid).localeCompare(String(b.uuid));
    });
    let spent = 0;
    let skill = 0;
    let glory = 0;
    const taken: string[] = [];
    for(const card of ranked) {
        const cost = printedCost(card, ctx) ?? 1;
        if(spent + cost > costCap) {
            continue;
        }
        spent += cost;
        skill += skillOf(card, 'military');
        glory += gloryOf(card);
        taken.push(String(card.id));
    }
    if(taken.length === 0 || skill <= 0) {
        return blocked('nothing-affordable');
    }
    return {
        selfSkill: skill,
        opponentSkill: 0,
        // The bodies stay on the board afterwards, so they are worth more than
        // the skill they add to this one conflict.
        abilityValue: Math.round((glory + taken.length * 2) * 10) / 10,
        reason: 'cavalry:' + taken.join('+') + '(' + spent + ')'
    };
}

// ---------------------------------------------------------------------------
// Siege
// ---------------------------------------------------------------------------

/**
 * Siege Warfare — while ATTACKING, and while we control a holding, the attacked
 * province gets -2 strength.
 *
 * Breaking requires our lead to reach the province's strength, so taking 2 off
 * the province is exactly as good as adding 2 skill — and cheaper than doing it
 * with a body. Reported through `provinceStrengthDelta` so the break math can
 * use it without pretending a character got bigger.
 */
export function siegeWarfareValue(ctx: CardValueContext, reduction = 2): CardValue {
    if(!ctx.amAttacker) {
        return blocked('attackers-only');
    }
    if(!ctx.activeConflict) {
        return blocked('not-during-conflict');
    }
    if(!ctx.haveHolding) {
        return blocked('no-holding-in-play');
    }
    const strength = Number(ctx.attackedProvinceStrength);
    if(Number.isFinite(strength) && strength <= 0) {
        return blocked('province-already-at-0');
    }
    // Only worth what it actually removes: a strength-1 province cannot give
    // back 2.
    const removed = Number.isFinite(strength) ? Math.min(reduction, strength) : reduction;
    return {
        selfSkill: 0,
        opponentSkill: 0,
        provinceStrengthDelta: -removed,
        // Scored like the skill it substitutes for, so a planner comparing this
        // against a pump compares like with like.
        abilityValue: removed,
        reason: 'siege:-' + removed
    };
}
