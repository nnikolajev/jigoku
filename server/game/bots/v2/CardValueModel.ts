// Context-aware card values for Bot V2.
//
// `DeckAnalysis` already carries a `swing` per card, but it is a flat constant:
// Assassination is worth 4 whether it kills a participating 5-skill defender or
// has no legal target at all. The action planner needs the real number, because
// it compares cards against a province-break threshold.
//
// These functions answer "what is this card worth RIGHT NOW", split into the
// three quantities the planner scores:
//
//   selfSkill      — skill added to our side of the live conflict
//   opponentSkill  — skill removed from theirs (negative)
//   abilityValue   — worth that is not skill, in score units where a province
//                    break is 100 and a bare conflict win is 25
//
// Shared primitives live in `CardValueTypes`; duel and dishonor machinery lives
// in `DuelValueModel`. Both are re-exported here so this module stays the single
// import for callers.
//
// V2 ONLY. Putting these into `CardPlaybook.conflictContribution` would change
// V1, which is frozen as the measurement control.

import { getCardModel } from '../DeckAnalysis.js';
import { isNegativeAttachmentId } from '../AttachmentControlTactics.js';
import {
    NOTHING,
    attachmentSkill,
    bodyValue,
    conflictSkillOf,
    contributesToConflict,
    gloryOf,
    hasTrait,
    hasTriggeredAbility,
    hold,
    investedValue,
    participating,
    printedCost,
    skillOf,
    strongestContributor,
    towerCharacter
} from './CardValueTypes.js';
import {
    challengeOnTheFieldsValue,
    defendYourHonorValue,
    duelToTheDeathValue,
    gameOfSadaneValue,
    iaijutsuMasterValue,
    insultToInjuryValue,
    policyDebateValue
} from './DuelValueModel.js';
import {
    cavalryReservesValue,
    censureValue,
    clarityOfPurposeValue,
    dutyValue,
    forgeryValue,
    kakitasFinalStanceValue,
    raiseTheAlarmValue,
    siegeWarfareValue,
    theMountainDoesNotFallValue
} from './SupportValueModel.js';
import {
    feedingAnArmyValue,
    forGreaterGloryValue,
    fruitfulRespiteValue,
    gossipValue,
    guardiansOfRokuganValue,
    levyValue,
    rebuildValue,
    spoilsOfWarValue,
    thePathOfManValue
} from './EconomyValueModel.js';
import { kaiuSiegeForceValue } from './HoldingValueModel.js';
import type { CardValue, CardValueContext, ValuedCharacter } from './CardValueTypes';

export * from './CardValueTypes.js';
export * from './DuelValueModel.js';
export * from './SupportValueModel.js';
export * from './EconomyValueModel.js';
export * from './HoldingValueModel.js';

// ---------------------------------------------------------------------------
// Per-card models
// ---------------------------------------------------------------------------

/**
 * Assassination — discard a printed-cost-2-or-lower character for 3 honor.
 *
 * Worth exactly the skill the victim is currently adding, plus the standing
 * value of removing the body. The honor charge is real: it is refused outright
 * when paying it would take us to or below the floor.
 */
export function assassinationValue(ctx: CardValueContext): CardValue {
    // Losing all honor loses the game, so this stays a hard refusal - but the
    // line is survival, not comfort. A floor of 5 refused Assassination at any
    // honor below 8, which measured as 56 refused plays in 18 games.
    const floor = Number.isFinite(Number(ctx.honorFloor)) ? Number(ctx.honorFloor) : 2;
    if(ctx.honor - 3 < floor) {
        return { ...NOTHING, reason: 'honor-too-low' };
    }
    const targets = ctx.opponentCharacters.filter((card) => (printedCost(card, ctx) ?? 99) <= 2);
    if(targets.length === 0) {
        return NOTHING;
    }
    // Prefer the biggest live contributor; fall back to the best body on board.
    const ranked = targets.slice().sort((a, b) =>
        conflictSkillOf(b, ctx.conflictType) - conflictSkillOf(a, ctx.conflictType) ||
        bodyValue(b, ctx) - bodyValue(a, ctx) ||
        String(a.uuid).localeCompare(String(b.uuid)));
    const best = ranked[0];
    const removed = conflictSkillOf(best, ctx.conflictType);
    return {
        selfSkill: 0,
        opponentSkill: -removed,
        abilityValue: bodyValue(best, ctx),
        honorCost: 3,
        reason: `assassinate:${best.id}`
    };
}

/**
 * Let Go — discard any attachment.
 *
 * Preference order, per deck guidance: strip a debuff off our tower, then a
 * strong enemy attachment, then a weak enemy one, then a debuff off a lesser
 * body of ours. Skill swing decides between close options; the tier only breaks
 * ties, so a large enemy buff still beats a token debuff on the tower.
 */
export function letGoValue(ctx: CardValueContext): CardValue {
    const type = ctx.conflictType;
    const tower = towerCharacter(ctx.myCharacters, type);
    interface Option { self: number; opponent: number; ability: number; tier: number; reason: string }
    const options: Option[] = [];

    for(const bearer of ctx.myCharacters) {
        for(const attachment of bearer.attachments || []) {
            if(!isNegativeAttachmentId(attachment.id)) {
                continue;
            }
            // Removing a debuff gives back whatever it was subtracting.
            const penalty = Math.abs(Math.min(0, attachmentSkill(attachment, type)));
            const live = contributesToConflict(bearer) ? penalty : 0;
            const isTower = !!tower && tower.uuid === bearer.uuid;
            options.push({
                self: live,
                opponent: 0,
                ability: isTower ? 10 : 5,
                tier: isTower ? 0 : 3,
                reason: `unblock:${attachment.id}@${bearer.id}`
            });
        }
    }
    for(const bearer of ctx.opponentCharacters) {
        for(const attachment of bearer.attachments || []) {
            const bonus = Math.max(0, attachmentSkill(attachment, type));
            const live = contributesToConflict(bearer) ? bonus : 0;
            const strong = bonus >= 2;
            options.push({
                self: 0,
                opponent: -live,
                ability: strong ? 8 : 3,
                tier: strong ? 1 : 2,
                reason: `strip:${attachment.id}@${bearer.id}`
            });
        }
    }
    if(options.length === 0) {
        return NOTHING;
    }
    const best = options.sort((a, b) => {
        const swing = (o: Option) => o.self + Math.abs(o.opponent);
        return swing(b) - swing(a) || a.tier - b.tier || b.ability - a.ability ||
            a.reason.localeCompare(b.reason);
    })[0];
    return { selfSkill: best.self, opponentSkill: best.opponent, abilityValue: best.ability, reason: best.reason };
}

/**
 * Court Games — honor a friendly participant or dishonor an opposing one.
 *
 * An honored character adds its glory to its skill, a dishonored one loses it,
 * so the swing is exactly the target's glory. Status does not stack, and only a
 * ready participant's skill reaches the conflict, so both are required.
 */
export function courtGamesValue(ctx: CardValueContext): CardValue {
    if(ctx.conflictType !== 'political') {
        return { ...NOTHING, reason: 'political-only' };
    }
    const honorTarget = ctx.myCharacters
        .filter((card) => contributesToConflict(card) && !card.honored && !card.dishonored)
        .sort((a, b) => gloryOf(b) - gloryOf(a) || String(a.uuid).localeCompare(String(b.uuid)))[0];
    const dishonorTarget = ctx.opponentCharacters
        .filter((card) => contributesToConflict(card) && !card.dishonored && !card.honored)
        .sort((a, b) => gloryOf(b) - gloryOf(a) || String(a.uuid).localeCompare(String(b.uuid)))[0];

    const honorGain = honorTarget ? gloryOf(honorTarget) : 0;
    const dishonorGain = dishonorTarget ? gloryOf(dishonorTarget) : 0;
    if(honorGain <= 0 && dishonorGain <= 0) {
        return NOTHING;
    }
    if(honorGain >= dishonorGain) {
        return { selfSkill: honorGain, opponentSkill: 0, abilityValue: 3, reason: `honor:${honorTarget?.id}` };
    }
    return { selfSkill: 0, opponentSkill: -dishonorGain, abilityValue: 3, reason: `dishonor:${dishonorTarget?.id}` };
}

/** Fire/skip tally for the cancel gate, for offline analysis only. */
export const voiceOfHonorTrace = { fired: 0, skipped: 0, unknown: 0 };

/** Same tally, per reaction card id. Diagnostics only — nothing reads it. */
export const reactionTrace: Record<string, { fired: number; skipped: number; unknown: number }> = {};

/**
 * Offline diagnostic hook, null in every shipped configuration. `export *`
 * re-exports are non-configurable, so an analysis script cannot wrap these
 * functions from outside; this is the supported way in.
 */
let reactionProbe: ((cardId: string, outcome: string, detail: string) => void) | null = null;

export function setReactionProbe(probe: typeof reactionProbe): void {
    reactionProbe = probe;
}

export function trackReaction(
    cardId: string,
    outcome: 'fired' | 'skipped' | 'unknown',
    detail = ''
): void {
    const entry = reactionTrace[cardId] || (reactionTrace[cardId] = { fired: 0, skipped: 0, unknown: 0 });
    entry[outcome]++;
    if(cardId === 'voice-of-honor') {
        voiceOfHonorTrace[outcome]++;
    }
    reactionProbe?.(cardId, outcome, detail);
}

/**
 * Voice of Honor — cancel an event, if we control more honored characters.
 *
 * A reaction: its worth is the worth of what it stops, which is only known when
 * the opponent commits. `incomingValue` is that estimate; below the threshold
 * the cancel is saved for something that matters.
 */
export function voiceOfHonorValue(ctx: CardValueContext, incomingValue = 0, threshold = 4): CardValue {
    const mine = ctx.myCharacters.filter((card) => card.honored).length;
    const theirs = ctx.opponentCharacters.filter((card) => card.honored).length;
    if(mine <= theirs) {
        return { ...NOTHING, reason: 'not-more-honored' };
    }
    if(incomingValue < threshold) {
        return { ...NOTHING, reason: 'incoming-below-threshold' };
    }
    return { selfSkill: 0, opponentSkill: 0, abilityValue: incomingValue, reason: 'cancel-event' };
}

/**
 * Make Your Case — political duel, 1 fate onto the winner.
 *
 * The opponent picks their duellist, so assume their best. The payoff is the
 * fate landing on our tower (it survives longer) plus any duel-win triggers,
 * not the conflict skill itself.
 */
export function makeYourCaseValue(ctx: CardValueContext): CardValue {
    const mine = ctx.myCharacters.filter((card) => contributesToConflict(card));
    if(mine.length === 0) {
        return NOTHING;
    }
    const ourBest = mine.sort((a, b) => skillOf(b, 'political') - skillOf(a, 'political'))[0];
    const theirBest = ctx.opponentCharacters
        .slice().sort((a, b) => skillOf(b, 'political') - skillOf(a, 'political'))[0];
    const margin = skillOf(ourBest, 'political') - skillOf(theirBest, 'political');
    if(margin < 0) {
        return hold('duel-unfavourable');
    }
    // Fate on a body we intend to keep is the whole point, so it is worth more
    // on a big investment than on a token participant.
    const keepValue = 4 + Math.min(4, Number(ourBest.fate) || 0);
    return { selfSkill: 0, opponentSkill: 0, abilityValue: keepValue, reason: `fate-on:${ourBest.id}` };
}

/**
 * Noble Sacrifice — sacrifice an honored character of ours, discard a
 * dishonored one of theirs. Net skill: what we give up against what we remove.
 */
export function nobleSacrificeValue(ctx: CardValueContext): CardValue {
    const fodderPool = ctx.myCharacters.filter((card) => card.honored);
    const victimPool = ctx.opponentCharacters.filter((card) => card.dishonored);
    if(fodderPool.length === 0 && victimPool.length === 0) {
        return { ...NOTHING, reason: 'no-honored-fodder+no-dishonored-victim' };
    }
    if(fodderPool.length === 0) {
        return { ...NOTHING, reason: 'no-honored-fodder' };
    }
    if(victimPool.length === 0) {
        return { ...NOTHING, reason: 'no-dishonored-victim' };
    }
    // This card is an INVESTMENT trade, not a skill trade: the point is to
    // sacrifice a cheap honored body to delete a character the opponent has
    // poured fate and attachments into. Current conflict skill is only part of
    // what is destroyed, so both sides are priced by total investment.
    const fodder = fodderPool.slice().sort((a, b) =>
        investedValue(a, ctx) - investedValue(b, ctx) ||
        conflictSkillOf(a, ctx.conflictType) - conflictSkillOf(b, ctx.conflictType))[0];
    const victim = victimPool.slice().sort((a, b) =>
        investedValue(b, ctx) - investedValue(a, ctx) ||
        conflictSkillOf(b, ctx.conflictType) - conflictSkillOf(a, ctx.conflictType))[0];
    const lost = conflictSkillOf(fodder, ctx.conflictType);
    const removed = conflictSkillOf(victim, ctx.conflictType);
    return {
        selfSkill: -lost,
        opponentSkill: -removed,
        abilityValue: investedValue(victim, ctx) - investedValue(fodder, ctx),
        reason: `sacrifice:${fodder.id}(${investedValue(fodder, ctx)})->${victim.id}(${investedValue(victim, ctx)})`
    };
}

/**
 * Oracle of Stone — both players draw 2 then discard 2.
 *
 * Symmetric, so it buys hand QUALITY, not advantage: worth firing when our hand
 * is mostly cards we cannot use, worthless when it is already live.
 */
export function oracleOfStoneValue(ctx: CardValueContext, weakThreshold = 0.4): CardValue {
    const hand = ctx.hand || [];
    if(hand.length === 0) {
        return NOTHING;
    }
    const live = hand.filter((card) => {
        const model = card.id ? getCardModel(card.id) : undefined;
        return !!model && (model.swing > 0 || model.mil > 0 || model.pol > 0 ||
            model.milBonus > 0 || model.polBonus > 0);
    }).length;
    const liveShare = live / hand.length;
    if(liveShare >= weakThreshold) {
        // A HOLD, not a veto: the card still draws and still cycles, so refusing
        // it outright is strictly worse than V1 playing it on a flat constant.
        return hold('hand-already-live');
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: Math.round((weakThreshold - liveShare) * 25),
        reason: `cycle-weak-hand:${live}/${hand.length}`
    };
}

/**
 * Kirei-ko — bow an opponent's character after it triggers an ability.
 *
 * The swing is whatever that character was contributing. With a single ability
 * holder on their board the trigger is forced, so take it; with several, hold
 * for one worth the card.
 */
export function kireiKoValue(ctx: CardValueContext, triggering?: ValuedCharacter, threshold = 3): CardValue {
    const holders = ctx.opponentCharacters.filter(hasTriggeredAbility);
    const target = triggering || holders
        .slice().sort((a, b) => conflictSkillOf(b, ctx.conflictType) - conflictSkillOf(a, ctx.conflictType))[0];
    if(!target) {
        return NOTHING;
    }
    const removed = conflictSkillOf(target, ctx.conflictType);
    // Only one ability holder means no better target is coming this round.
    if(holders.length > 1 && removed < threshold) {
        return hold('holding-for-better-target');
    }
    return { selfSkill: 0, opponentSkill: -removed, abilityValue: removed > 0 ? 4 : 1, reason: `bow:${target.id}` };
}

/**
 * In Service to My Lord — bow a non-unique of ours, ready a unique of ours.
 *
 * Net skill: what the readied body can now add, less whatever the bowed one was
 * already adding. Bowing a body that is doing nothing is free.
 */
export function inServiceValue(ctx: CardValueContext): CardValue {
    const fodder = ctx.myCharacters.filter((card) => !card.isUnique && !card.bowed)
        .sort((a, b) => conflictSkillOf(a, ctx.conflictType) - conflictSkillOf(b, ctx.conflictType) ||
            skillOf(a, ctx.conflictType) - skillOf(b, ctx.conflictType))[0];
    const readyTarget = ctx.myCharacters.filter((card) => card.isUnique && card.bowed)
        .sort((a, b) => skillOf(b, ctx.conflictType) - skillOf(a, ctx.conflictType))[0];
    if(!fodder || !readyTarget) {
        return NOTHING;
    }
    const lost = conflictSkillOf(fodder, ctx.conflictType);
    // A readied body only adds skill to THIS conflict if it is already in it;
    // otherwise the gain is a standing one (it can defend or declare later).
    const gainedNow = readyTarget.inConflict ? skillOf(readyTarget, ctx.conflictType) : 0;
    const standing = readyTarget.inConflict ? 0 : Math.min(8, skillOf(readyTarget, ctx.conflictType));
    return {
        selfSkill: gainedNow - lost,
        opponentSkill: 0,
        abilityValue: standing,
        reason: `ready:${readyTarget.id}<-bow:${fodder.id}`
    };
}

/**
 * Make an Opening - the chosen enemy participant gets -X to both skills, where
 * X is the gap between the revealed honor dials. A zero or negative gap makes
 * the card do literally nothing, which is why this has to be computed live.
 */
export function makeAnOpeningValue(ctx: CardValueContext): CardValue {
    // X is the DIFFERENCE between the two dials, not a signed subtraction:
    // bidding lower than the opponent is just as good, which is precisely why
    // the low-bidding dishonor deck runs this card.
    const gap = Math.abs((Number(ctx.myBid) || 0) - (Number(ctx.opponentBid) || 0));
    if(gap <= 0) {
        return { ...NOTHING, reason: 'bid-gap-0' };
    }
    if(participating(ctx.myCharacters).length === 0) {
        return { ...NOTHING, reason: 'no-participant-of-ours' };
    }
    const target = strongestContributor(participating(ctx.opponentCharacters), ctx.conflictType);
    const removed = Math.min(gap, conflictSkillOf(target, ctx.conflictType));
    if(removed <= 0) {
        return { ...NOTHING, reason: 'no-live-target' };
    }
    return { selfSkill: 0, opponentSkill: -removed, abilityValue: 2, reason: 'debuff-' + gap + ':' + target?.id };
}

/**
 * Rout - move an enemy home if it has lower military than a participating Bushi
 * of ours. Our Bushi only has to be participating, bowed or not; the victim must
 * be a live contributor or moving it home changes nothing.
 */
export function routValue(ctx: CardValueContext): CardValue {
    const bushi = participating(ctx.myCharacters).filter((card) => hasTrait(card, 'bushi'));
    if(bushi.length === 0) {
        return { ...NOTHING, reason: 'no-participating-bushi' };
    }
    const ceiling = Math.max(...bushi.map((card) => skillOf(card, 'military')));
    const target = strongestContributor(
        participating(ctx.opponentCharacters).filter((card) =>
            !card.bowed && skillOf(card, 'military') < ceiling),
        ctx.conflictType);
    const removed = conflictSkillOf(target, ctx.conflictType);
    if(!target || removed <= 0) {
        return { ...NOTHING, reason: 'no-eligible-target' };
    }
    return { selfSkill: 0, opponentSkill: -removed, abilityValue: 3, reason: 'rout:' + target.id };
}

/**
 * Void Fist - needs 2 other cards played this conflict, then moves home a
 * participant with military at or below a participating Monk of ours.
 */
export function voidFistValue(ctx: CardValueContext): CardValue {
    if((Number(ctx.cardsPlayed) || 0) < 2) {
        return { ...NOTHING, reason: 'needs-2-cards-played' };
    }
    const monks = participating(ctx.myCharacters).filter((card) => hasTrait(card, 'monk'));
    if(monks.length === 0) {
        return { ...NOTHING, reason: 'no-participating-monk' };
    }
    const ceiling = Math.max(...monks.map((card) => skillOf(card, 'military')));
    const target = strongestContributor(
        participating(ctx.opponentCharacters).filter((card) =>
            !card.bowed && skillOf(card, 'military') <= ceiling),
        ctx.conflictType);
    const removed = conflictSkillOf(target, ctx.conflictType);
    if(!target || removed <= 0) {
        return { ...NOTHING, reason: 'no-eligible-target' };
    }
    return { selfSkill: 0, opponentSkill: -removed, abilityValue: 3, reason: 'void-fist:' + target.id };
}

/**
 * Flank the Enemy - the OPPONENT picks which of their participants bows, so
 * price it at their weakest, not their best. Requires us to outnumber them.
 */
export function flankTheEnemyValue(ctx: CardValueContext): CardValue {
    const mine = participating(ctx.myCharacters).length;
    const theirs = participating(ctx.opponentCharacters).filter((card) => !card.bowed);
    if(mine <= theirs.length) {
        return { ...NOTHING, reason: 'not-outnumbering' };
    }
    if(theirs.length === 0) {
        return { ...NOTHING, reason: 'no-standing-defender' };
    }
    const weakest = theirs.slice().sort((a, b) =>
        conflictSkillOf(a, ctx.conflictType) - conflictSkillOf(b, ctx.conflictType) ||
        String(a.uuid).localeCompare(String(b.uuid)))[0];
    const removed = conflictSkillOf(weakest, ctx.conflictType);
    if(removed <= 0) {
        return { ...NOTHING, reason: 'their-cheapest-costs-them-nothing' };
    }
    return { selfSkill: 0, opponentSkill: -removed, abilityValue: 2, reason: 'flank:' + weakest.id };
}

/**
 * Earth Becomes Sky - bow an opponent's character after it readies. Only worth
 * the card on a target above the threshold; bigger target, bigger payoff.
 */
export function earthBecomesSkyValue(ctx: CardValueContext, readied?: ValuedCharacter, threshold = 3): CardValue {
    const target = readied || strongestContributor(participating(ctx.opponentCharacters), ctx.conflictType);
    const removed = conflictSkillOf(target, ctx.conflictType);
    if(!target || removed <= 0) {
        return { ...NOTHING, reason: 'no-live-target' };
    }
    if(removed < threshold) {
        return hold('below-threshold-' + removed);
    }
    return { selfSkill: 0, opponentSkill: -removed, abilityValue: 3, reason: 'bow:' + target.id };
}

/**
 * Ujiaki's Offer - political only. Pick our highest printed cost participant,
 * then the strongest enemy participant at or below that cost: the card takes it
 * out of the conflict, so its whole contribution is the value.
 */
export function ujiakisOfferValue(ctx: CardValueContext): CardValue {
    if(ctx.conflictType !== 'political') {
        return { ...NOTHING, reason: 'political-only' };
    }
    const mine = participating(ctx.myCharacters);
    if(mine.length === 0) {
        return { ...NOTHING, reason: 'no-participant-of-ours' };
    }
    const ceiling = Math.max(...mine.map((card) => printedCost(card, ctx) ?? 0));
    const target = strongestContributor(
        participating(ctx.opponentCharacters).filter((card) => (printedCost(card, ctx) ?? 99) <= ceiling),
        'political');
    const removed = conflictSkillOf(target, 'political');
    if(!target || removed <= 0) {
        return { ...NOTHING, reason: 'no-eligible-target' };
    }
    return { selfSkill: 0, opponentSkill: -removed, abilityValue: 3, reason: 'ujiaki:' + target.id };
}

/**
 * Storied Defeat - bow a character that lost a duel this conflict, optionally
 * paying 1 fate to dishonor it. The dishonor is only worth the fate on a glory
 * target the opponent has invested in.
 */
export function storiedDefeatValue(ctx: CardValueContext, dishonorThreshold = 4): CardValue {
    const losers = new Set(ctx.duelLoserUuids || []);
    if(losers.size === 0) {
        return { ...NOTHING, reason: 'no-duel-loser' };
    }
    const target = strongestContributor(
        ctx.opponentCharacters.filter((card) => card.uuid && losers.has(card.uuid)),
        ctx.conflictType);
    if(!target) {
        return { ...NOTHING, reason: 'duel-loser-not-theirs' };
    }
    const removed = conflictSkillOf(target, ctx.conflictType);
    // Bowing is worth more against a body the opponent has poured resources
    // into than against a token duellist, so the removal is priced by the
    // target's power and investment, not by its live skill alone.
    const power = Math.round(investedValue(target, ctx) / 2);
    const dishonorWorth = gloryOf(target) + (Number(target.fate) || 0);
    const dishonor = !target.dishonored && !target.honored && dishonorWorth >= dishonorThreshold;
    return {
        selfSkill: 0,
        opponentSkill: -removed,
        abilityValue: 2 + power + (dishonor ? dishonorWorth : 0),
        reason: 'bow:' + target.id + '(' + power + ')' + (dishonor ? '+dishonor' : '')
    };
}

// ---------------------------------------------------------------------------

export type CardValueFn = (ctx: CardValueContext) => CardValue;

/** Cards whose worth is computed live instead of read from a flat constant. */
export const CARD_VALUE_MODEL: Readonly<Record<string, CardValueFn>> = Object.freeze({
    'assassination': assassinationValue,
    'let-go': letGoValue,
    'court-games': courtGamesValue,
    'make-your-case': makeYourCaseValue,
    'noble-sacrifice': nobleSacrificeValue,
    'oracle-of-stone': (ctx) => oracleOfStoneValue(ctx),
    'kirei-ko': (ctx) => kireiKoValue(ctx),
    'in-service-to-my-lord': inServiceValue,
    'make-an-opening': makeAnOpeningValue,
    'rout': routValue,
    'void-fist': voidFistValue,
    'flank-the-enemy': flankTheEnemyValue,
    'earth-becomes-sky': (ctx) => earthBecomesSkyValue(ctx),
    'ujiaki-s-offer': ujiakisOfferValue,
    'storied-defeat': (ctx) => storiedDefeatValue(ctx),
    // Duels. Each supplies the SHAPE of its outcome; the shared duel model in
    // `DuelValueModel` turns that into odds, synergy, and a number.
    'game-of-sadane': (ctx) => gameOfSadaneValue(ctx),
    'policy-debate': (ctx) => policyDebateValue(ctx),
    'duel-to-the-death': (ctx) => duelToTheDeathValue(ctx),
    'challenge-on-the-fields': (ctx) => challengeOnTheFieldsValue(ctx),
    'iaijutsu-master': iaijutsuMasterValue,
    // Reaction-window cards: the planner cannot see what it would cancel or
    // which duel just resolved, so they price at zero here and are valued by
    // the reaction path instead.
    'voice-of-honor': (ctx) => voiceOfHonorValue(ctx),
    'defend-your-honor': (ctx) => defendYourHonorValue(ctx),
    'insult-to-injury': (ctx) => insultToInjuryValue(ctx),
    'censure': (ctx) => censureValue(ctx),
    'forgery': (ctx) => forgeryValue(ctx),
    'duty': (ctx) => dutyValue(ctx),
    // Protection, reinforcement and siege.
    'clarity-of-purpose': clarityOfPurposeValue,
    'kakita-s-final-stance': kakitasFinalStanceValue,
    'the-mountain-does-not-fall': theMountainDoesNotFallValue,
    'raise-the-alarm': (ctx) => raiseTheAlarmValue(ctx),
    'cavalry-reserves': (ctx) => cavalryReservesValue(ctx),
    'siege-warfare': (ctx) => siegeWarfareValue(ctx),
    // Economy / tempo / resource denial. Actions price a real choice; the
    // reactions below them are listed so a planner can see them at all, but the
    // trigger is what decides those.
    'levy': (ctx) => levyValue(ctx),
    'rebuild': (ctx) => rebuildValue(ctx, ctx.discardHoldingStrengths, ctx.provinceHoldingStrength),
    'gossip': (ctx) => gossipValue(ctx, ctx.bestBlockableThreat),
    'fruitful-respite': () => fruitfulRespiteValue(),
    'spoils-of-war': () => spoilsOfWarValue(),
    'the-path-of-man': (ctx) => thePathOfManValue(ctx, ctx.conflictSkillDifference),
    'guardians-of-rokugan': (ctx) => guardiansOfRokuganValue(ctx, ctx.conflictSkillDifference),
    'for-greater-glory': forGreaterGloryValue,
    'feeding-an-army': (ctx) => feedingAnArmyValue(ctx),
    // In-play ability that spends a board resource rather than a card.
    'kaiu-siege-force': (ctx) => kaiuSiegeForceValue(ctx)
});

/**
 * Cards that can only ever be played in their own reaction/interrupt window.
 * Their value depends on what the opponent just did, which the card-play
 * pipeline cannot see, so the pipeline must not veto them on a zero reading.
 */
export const REACTION_ONLY_CARDS: ReadonlySet<string> = new Set([
    'voice-of-honor', 'defend-your-honor', 'insult-to-injury',
    'censure', 'forgery', 'duty',
    // Reaction: bows an opponent's character AFTER it readies, so the hand-play
    // pipeline never sees it and must not veto it either.
    'earth-becomes-sky',
    // Economy reactions: the trigger decides these, not a hand-play window.
    'fruitful-respite', 'spoils-of-war', 'the-path-of-man', 'guardians-of-rokugan',
    'for-greater-glory', 'feeding-an-army'
]);

export function hasCardValueModel(cardId: string | undefined): boolean {
    return !!cardId && Object.prototype.hasOwnProperty.call(CARD_VALUE_MODEL, cardId);
}

/**
 * Offline diagnostic hook, null in every shipped configuration. Observes only:
 * no value, ordering, or decision depends on it.
 */
let valueProbe: ((cardId: string, value: CardValue) => void) | null = null;

export function setCardValueProbe(probe: typeof valueProbe): void {
    valueProbe = probe;
}

export function valueCard(cardId: string | undefined, ctx: CardValueContext): CardValue | null {
    if(!hasCardValueModel(cardId)) {
        return null;
    }
    try {
        const value = CARD_VALUE_MODEL[cardId as string](ctx);
        valueProbe?.(cardId as string, value);
        return value;
    } catch{
        return null;
    }
}
