// SHARED (V1 + V2). Lived under `v2/` until 2026-08-13; moved to `shared/`
// once measurement showed V1 imports it at RUNTIME, so it was never
// experimental. Changing it changes the shipping bot — prove any edit
// bit-identical with `tools/selfplay/refactorIdentity.js`.
//
// Duel and dishonor values, shared by Bot V1 and Bot V2.
//
// Every duel card in the pool asks the same three questions, so they are asked
// once here instead of seven times:
//
//   1. `projectDuel`          — who duels whom, and do we win it?
//   2. `duelSynergyValue`     — what ELSE in hand pays off from this duel?
//   3. `dishonorValue` /
//      `dishonorFollowUpValue`— what is taking their glory away worth?
//
// That split is what makes Duel to the Death count towards Game of Sadane (which
// dishonors, and a dishonored character can no longer refuse a Duel to the
// Death) but not towards Policy Debate (which only discards a card). The card
// functions below supply the SHAPE of their duel's outcome; the shared model
// turns that shape into a number.
//

import { getCardModel } from '../DeckAnalysis.js';
import {
    blocked,
    hold,
    conflictSkillOf,
    contributesToConflict,
    gloryOf,
    handCardCost,
    hasTrait,
    investedValue,
    participating,
    skillOf
} from './CardValueTypes.js';
import type { CardValue, CardValueContext, ValuedCharacter, ValuedHandCard } from './CardValueTypes';

// ---------------------------------------------------------------------------
// Duel odds
// ---------------------------------------------------------------------------

/**
 * The highest honor bid a player can make without handing the game away.
 *
 * The higher bidder transfers the difference to the lower one, so a player on 3
 * honor bidding 5 into a bid of 1 loses 4 honor and can lose outright. Modelling
 * that ceiling is what stops the bot from assuming a desperate opponent will
 * always meet its bid.
 */
export function bidCeiling(honor: number | undefined): number {
    const value = Number.isFinite(Number(honor)) ? Number(honor) : 12;
    return Math.max(1, Math.min(5, Math.floor(value / 2) + 1));
}

export interface DuelOdds {
    win: number;
    draw: number;
    loss: number;
}

/**
 * Odds over every legal bid pairing, assuming each side bids uniformly up to its
 * own affordable ceiling. A duel is a simultaneous secret bid, so enumerating
 * the matrix is both cheaper and more honest than a fitted curve. Ties produce
 * no winner and no loser, which is why `draw` is tracked separately: a card
 * whose whole payoff is "discard the loser" gets nothing from a draw.
 */
export function duelOdds(margin: number, myCeiling = 5, theirCeiling = 5): DuelOdds {
    let win = 0;
    let draw = 0;
    let loss = 0;
    let total = 0;
    for(let mine = 1; mine <= myCeiling; mine++) {
        for(let theirs = 1; theirs <= theirCeiling; theirs++) {
            const result = margin + mine - theirs;
            total++;
            if(result > 0) {
                win++;
            } else if(result === 0) {
                draw++;
            } else {
                loss++;
            }
        }
    }
    if(total === 0) {
        return { win: 0, draw: 1, loss: 0 };
    }
    return { win: win / total, draw: draw / total, loss: loss / total };
}

/** An Iaijutsu Master on the duellist buys a point of bid after dials reveal. */
export function duelBidEdge(card: ValuedCharacter | undefined): number {
    return (card?.attachments || []).some((attachment) => attachment.id === 'iaijutsu-master') ? 1 : 0;
}

export interface DuelPlan {
    challenger?: ValuedCharacter;
    target?: ValuedCharacter;
    /** Our duel skill minus theirs, before either honor bid. */
    margin: number;
    odds: DuelOdds;
    reason: string;
}

export interface DuelPlanOptions {
    type: 'military' | 'political';
    /**
     * The opponent picks which of their characters duels (`opponentChoosesDuel-
     * Target`), so assume their best rather than the one we would like.
     */
    theyPickTarget?: boolean;
    /** Flat skill the card grants each side (Challenge on the Fields). */
    myBonus?: number;
    theirBonus?: number;
    /** How much beating this particular target is worth, for target choice. */
    targetWorth?: (card: ValuedCharacter) => number;
    targetFilter?: (card: ValuedCharacter) => boolean;
    /** Refuse targets we do not beat at least this often. */
    minWinProbability?: number;
    /**
     * `risk` sends the smallest body that still wins, for cards that discard or
     * send home the loser; `best` always fields our strongest.
     */
    challengerPolicy?: 'best' | 'risk';
}

const NO_PLAN: DuelPlan = { margin: 0, odds: { win: 0, draw: 1, loss: 0 }, reason: 'no-duel' };

/**
 * Pick the duel this card should start, and price our chances in it.
 *
 * Duels are fought on printed/current skill regardless of bowed state, so this
 * deliberately uses `skillOf`, not `conflictSkillOf`. What the target is WORTH
 * still comes from its live contribution — that is the caller's `targetWorth`.
 */
export function projectDuel(ctx: CardValueContext, options: DuelPlanOptions): DuelPlan {
    const type = options.type;
    const myCeiling = bidCeiling(ctx.honor);
    const theirCeiling = bidCeiling(ctx.opponentHonor);
    const myBonus = Number(options.myBonus) || 0;
    const theirBonus = Number(options.theirBonus) || 0;
    const minWin = Number.isFinite(Number(options.minWinProbability)) ? Number(options.minWinProbability) : 0;

    const challengers = participating(ctx.myCharacters);
    if(challengers.length === 0) {
        return { ...NO_PLAN, reason: 'no-participant-of-ours' };
    }
    let candidates = participating(ctx.opponentCharacters);
    if(options.targetFilter) {
        candidates = candidates.filter(options.targetFilter);
    }
    if(candidates.length === 0) {
        return { ...NO_PLAN, reason: 'no-eligible-target' };
    }

    const bestChallenger = challengers.slice().sort((a, b) =>
        skillOf(b, type) + duelBidEdge(b) - (skillOf(a, type) + duelBidEdge(a)) ||
        String(a.uuid).localeCompare(String(b.uuid)))[0];

    const oddsFor = (challenger: ValuedCharacter, target: ValuedCharacter): { margin: number; odds: DuelOdds } => {
        const margin = skillOf(challenger, type) + myBonus + duelBidEdge(challenger) -
            (skillOf(target, type) + theirBonus + duelBidEdge(target));
        return { margin, odds: duelOdds(margin, myCeiling, theirCeiling) };
    };

    // Their pick: they field whichever of theirs beats our best most comfortably.
    if(options.theyPickTarget) {
        const target = candidates.slice().sort((a, b) =>
            skillOf(b, type) + duelBidEdge(b) - (skillOf(a, type) + duelBidEdge(a)) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0];
        const { margin, odds } = oddsFor(bestChallenger, target);
        return { challenger: bestChallenger, target, margin, odds, reason: 'they-pick:' + target.id };
    }

    // Send the cheapest body that still clears the bar when losing costs us the
    // duellist; otherwise our strongest, because only the odds matter.
    const pickChallenger = (target: ValuedCharacter): ValuedCharacter => {
        if(options.challengerPolicy !== 'risk') {
            return bestChallenger;
        }
        const affordableLoss = challengers.slice().sort((a, b) =>
            investedValue(a, ctx) - investedValue(b, ctx) ||
            String(a.uuid).localeCompare(String(b.uuid)));
        for(const candidate of affordableLoss) {
            if(oddsFor(candidate, target).odds.win >= Math.max(minWin, 0.5)) {
                return candidate;
            }
        }
        return bestChallenger;
    };

    const worth = options.targetWorth || ((card: ValuedCharacter) => conflictSkillOf(card, type));
    let best: DuelPlan | null = null;
    let bestScore = -Infinity;
    for(const target of candidates) {
        const challenger = pickChallenger(target);
        const { margin, odds } = oddsFor(challenger, target);
        if(odds.win < minWin) {
            continue;
        }
        // Expected payoff, not raw payoff: a huge target we lose to 80% of the
        // time is worse than a modest one we beat.
        const score = worth(target) * odds.win;
        if(score > bestScore ||
            (score === bestScore && String(target.uuid).localeCompare(String(best?.target?.uuid)) < 0)) {
            bestScore = score;
            best = { challenger, target, margin, odds, reason: 'duel:' + challenger.id + '->' + target.id };
        }
    }
    return best || { ...NO_PLAN, reason: 'no-winnable-target' };
}

// ---------------------------------------------------------------------------
// Honor status
// ---------------------------------------------------------------------------

export interface StatusValue {
    /** Skill this moves in the live conflict. */
    skill: number;
    /** Everything else it is worth: board position and follow-up cards. */
    ability: number;
    blocked?: boolean;
    reason: string;
}

const NO_STATUS: StatusValue = { skill: 0, ability: 0, blocked: true, reason: 'no-target' };

/**
 * What taking an opposing character's honor is worth.
 *
 * A dishonored character subtracts its glory from both skills, so the live swing
 * is exactly its glory — and only if it is standing in the conflict. Two other
 * things ride along, and both matter more than the skill for a dishonor deck:
 * an honored target merely loses its token (no dishonored status, no follow-up),
 * and a character that is ALREADY dishonored cannot be dishonored again, which
 * is what makes Duel to the Death unrefusable against it.
 */
export function dishonorValue(ctx: CardValueContext, target: ValuedCharacter | undefined): StatusValue {
    if(!target) {
        return NO_STATUS;
    }
    if(target.dishonored) {
        return { ...NO_STATUS, reason: 'already-dishonored' };
    }
    const glory = gloryOf(target);
    const live = contributesToConflict(target) ? glory : 0;
    if(target.honored) {
        // The token comes off and the character ends up neutral: we take the
        // glory bonus away but open no dishonor follow-up.
        return { skill: live, ability: 2, reason: 'strip-honored:' + target.id };
    }
    const followUp = dishonorFollowUpValue(ctx, target);
    return {
        skill: live,
        ability: 2 + followUp.value,
        reason: 'dishonor:' + target.id + (followUp.detail.length > 0 ? '+' + followUp.detail.join('+') : '')
    };
}

/** Mirror of `dishonorValue` for our own side: honored adds glory to skill. */
export function honorValue(ctx: CardValueContext, target: ValuedCharacter | undefined): StatusValue {
    if(!target) {
        return NO_STATUS;
    }
    if(target.honored) {
        return { ...NO_STATUS, reason: 'already-honored' };
    }
    const glory = gloryOf(target);
    const live = contributesToConflict(target) ? glory : 0;
    if(target.dishonored) {
        // Honoring a dishonored character only clears the token, but that is
        // worth the same glory swing and restores it as Noble Sacrifice fodder.
        return { skill: live, ability: 2, reason: 'clear-dishonor:' + target.id };
    }
    return { skill: live, ability: 2, reason: 'honor:' + target.id };
}

/**
 * Cards in hand that only turn on once an opposing character is dishonored.
 *
 * This is the "how many dishonor follow-ups do I hold" count the dishonor plan
 * is priced on. Each entry says what the follow-up would be worth against THIS
 * target, so dishonoring a fate-loaded tower is correctly worth more than
 * dishonoring a token body.
 */
export function dishonorFollowUpValue(
    ctx: CardValueContext,
    target: ValuedCharacter | undefined
): { value: number; detail: string[] } {
    if(!target) {
        return { value: 0, detail: [] };
    }
    const detail: string[] = [];
    let value = 0;
    const holds = (id: string) => (ctx.hand || []).some((card) => card.id === id);
    const affordable = (id: string) => {
        const card = (ctx.hand || []).find((entry) => entry.id === id);
        const cost = handCardCost(card, ctx);
        return !Number.isFinite(Number(cost)) || Number(cost) <= (Number(ctx.fate) || 0);
    };

    // Noble Sacrifice deletes a dishonored character outright, paying an honored
    // body of ours. Worth roughly what the opponent has sunk into the target.
    if(holds('noble-sacrifice') && affordable('noble-sacrifice') &&
        ctx.myCharacters.some((card) => card.honored)) {
        value += Math.min(12, Math.round(investedValue(target, ctx) / 2));
        detail.push('noble-sacrifice');
    }
    // A dishonored character cannot be dishonored again, so it cannot refuse a
    // Duel to the Death: the refusal branch has no legal target.
    if(holds('duel-to-the-death') && affordable('duel-to-the-death')) {
        value += Math.min(8, conflictSkillOf(target, ctx.conflictType));
        detail.push('duel-to-the-death');
    }
    return { value, detail };
}

// ---------------------------------------------------------------------------
// Duel synergy
// ---------------------------------------------------------------------------

/** What a particular duel card's resolution does, for synergy pricing. */
export interface DuelOutcomeShape {
    type: 'military' | 'political';
    dishonorsLoser?: boolean;
    discardsLoser?: boolean;
    sendsLoserHome?: boolean;
}

export interface DuelSynergy {
    /** Skill the synergy adds to the live conflict. */
    skill: number;
    /** Non-skill worth. */
    ability: number;
    detail: string[];
}

const NO_SYNERGY: DuelSynergy = { skill: 0, ability: 0, detail: [] };

/**
 * Everything OTHER than the duel card itself that pays off from starting this
 * duel right now. Shared by every duel card so that "is a duel good at this
 * moment" is answered in exactly one place.
 */
export function duelSynergyValue(
    ctx: CardValueContext,
    shape: DuelOutcomeShape,
    plan: DuelPlan
): DuelSynergy {
    if(!plan.target || !plan.challenger) {
        return NO_SYNERGY;
    }
    const detail: string[] = [];
    let skill = 0;
    let ability = 0;
    const holds = (id: string) => (ctx.hand || []).some((card) => card.id === id);
    const winOdds = plan.odds.win;

    // Deliberately NOT priced here: whatever the duel card does itself. Game of
    // Sadane's own honor/dishonor is its value, not its synergy, and counting it
    // in both places doubles it.

    // Any duel that resolves with a loser feeds Storied Defeat, which bows it.
    const producesLoser = winOdds > 0 || plan.odds.loss > 0;
    if(producesLoser && holds('storied-defeat')) {
        ability += Math.min(10, conflictSkillOf(plan.target, shape.type) +
            Math.round(investedValue(plan.target, ctx) / 4)) * winOdds;
        detail.push('storied-defeat');
    }

    // Insult to Injury dishonors the loser, but only when OUR duellist is a
    // Duelist and it is our side that won.
    const insultLands = holds('insult-to-injury') && hasTrait(plan.challenger, 'duelist');
    if(insultLands && !shape.dishonorsLoser) {
        const dishonored = dishonorValue(ctx, plan.target);
        if(!dishonored.blocked) {
            skill += dishonored.skill * winOdds;
            ability += dishonored.ability * winOdds;
            detail.push('insult-to-injury');
        }
    }

    // The duel's own dishonor already priced its follow-ups inside
    // `dishonorValue`, so only count them here when the duel does NOT dishonor
    // and Insult to Injury is what supplies it.
    if(shape.dishonorsLoser && !insultLands) {
        detail.push('dishonors-loser');
    }
    return { skill, ability, detail };
}

/** Duel-tagged conflict cards we hold and can pay for — Iaijutsu Master's worth. */
export function duelCardsInHand(ctx: CardValueContext): ValuedHandCard[] {
    return (ctx.hand || []).filter((card) => {
        const model = card.id ? getCardModel(card.id) : undefined;
        if(!model || model.tag !== 'duel' || model.side !== 'conflict') {
            return false;
        }
        const cost = handCardCost(card, ctx);
        return !Number.isFinite(Number(cost)) || Number(cost) <= (Number(ctx.fate) || 0);
    });
}

// ---------------------------------------------------------------------------
// Per-card models
// ---------------------------------------------------------------------------

function combine(plan: DuelPlan, synergy: DuelSynergy, base: number, reason: string): CardValue {
    return {
        selfSkill: Math.round(synergy.skill * 10) / 10,
        opponentSkill: 0,
        abilityValue: Math.round((base + synergy.ability) * 10) / 10,
        reason: reason + (synergy.detail.length > 0 ? '|' + synergy.detail.join('+') : '')
    };
}

/**
 * Game of Sadane — political duel; honor the winner, dishonor the loser.
 *
 * The printed glory swing is only half of it. The dishonor is what the deck
 * actually wants, because a dishonored character is Noble Sacrifice food and can
 * no longer refuse a Duel to the Death — so the follow-ups in hand are priced
 * in through `dishonorValue`. Losing is symmetrically bad (they get honored, we
 * get dishonored), so both branches are weighted by the duel odds.
 */
export function gameOfSadaneValue(ctx: CardValueContext, minWinProbability = 0.5): CardValue {
    if(ctx.conflictType !== 'political') {
        return blocked('political-only');
    }
    const plan = projectDuel(ctx, {
        type: 'political',
        minWinProbability,
        targetWorth: (card) => {
            const value = dishonorValue(ctx, card);
            return value.blocked ? 0 : value.skill + value.ability;
        },
        targetFilter: (card) => !card.dishonored
    });
    if(!plan.target || !plan.challenger) {
        // `no-winnable-target` means we would probably lose, not that the play
        // is illegal, so it must not veto the card out of V1's pipeline.
        return plan.reason === 'no-winnable-target' ? hold(plan.reason) : blocked(plan.reason);
    }
    const theirLoss = dishonorValue(ctx, plan.target);
    const ourGain = honorValue(ctx, plan.challenger);
    // Losing hands them the mirror image of the same swing.
    const ourLoss = dishonorValue(ctx, plan.challenger);
    const theirGain = honorValue(ctx, plan.target);
    const synergy = duelSynergyValue(ctx, { type: 'political', dishonorsLoser: true }, plan);

    const selfSkill = ourGain.skill * plan.odds.win - ourLoss.skill * plan.odds.loss + synergy.skill;
    const opponentSkill = -(theirLoss.skill * plan.odds.win) + theirGain.skill * plan.odds.loss;
    const ability = (theirLoss.ability + ourGain.ability) * plan.odds.win -
        (ourLoss.ability + theirGain.ability) * plan.odds.loss + synergy.ability;
    if(selfSkill + Math.abs(opponentSkill) + ability <= 0) {
        return hold('duel-not-worth-it');
    }
    return {
        selfSkill: Math.round(selfSkill * 10) / 10,
        opponentSkill: Math.round(opponentSkill * 10) / 10,
        abilityValue: Math.round(ability * 10) / 10,
        reason: plan.reason + (synergy.detail.length > 0 ? '|' + synergy.detail.join('+') : '')
    };
}

/** Rough worth of an unseen or seen card sitting in a hand. */
export function handCardThreat(card: ValuedHandCard | undefined): number {
    const model = card?.id ? getCardModel(card.id) : undefined;
    if(!model) {
        // An unmodelled conflict card is not worthless, it is unknown; 2 is the
        // median swing of the modelled pool.
        return 2;
    }
    return Math.max(
        model.swing,
        model.milBonus,
        model.polBonus,
        Math.round(Math.max(model.mil, model.pol) / 2)
    );
}

/**
 * Policy Debate — political duel; the LOSER reveals their hand and their
 * opponent discards a card from it.
 *
 * The value is the best card we can take out of their hand, so it is read
 * straight off the hand when the omniscient capability is on and estimated from
 * hand size otherwise. It cuts both ways: losing means they strip our best card,
 * which is why the loss branch is subtracted rather than ignored.
 *
 * No dishonor and no discarded body, so the dishonor follow-ups in hand
 * deliberately contribute nothing here.
 */
export function policyDebateValue(ctx: CardValueContext, minWinProbability = 0.5): CardValue {
    if(ctx.conflictType !== 'political') {
        return blocked('political-only');
    }
    const plan = projectDuel(ctx, { type: 'political', minWinProbability });
    if(!plan.target || !plan.challenger) {
        // `no-winnable-target` means we would probably lose, not that the play
        // is illegal, so it must not veto the card out of V1's pipeline.
        return plan.reason === 'no-winnable-target' ? hold(plan.reason) : blocked(plan.reason);
    }
    const best = (cards: ValuedHandCard[] | undefined, size: number | undefined): number => {
        if(cards && cards.length > 0) {
            return Math.max(...cards.map(handCardThreat));
        }
        const count = Number(size) || 0;
        if(count <= 0) {
            return 0;
        }
        // Unseen hand: the more cards there are, the better the best of them is.
        return Math.min(6, 2 + Math.round(count / 2));
    };
    const theirBest = best(ctx.opponentHand, ctx.opponentHandSize ?? ctx.opponentHand?.length);
    const ourBest = best(ctx.hand, ctx.hand?.length);
    if(theirBest <= 0) {
        return blocked('their-hand-empty');
    }
    const synergy = duelSynergyValue(ctx, { type: 'political' }, plan);
    const ability = theirBest * plan.odds.win - ourBest * plan.odds.loss + synergy.ability;
    if(ability <= 0) {
        return hold('discard-trade-negative');
    }
    return combine(plan, synergy, theirBest * plan.odds.win - ourBest * plan.odds.loss,
        'debate:' + plan.challenger.id + '->' + plan.target.id + '(' + theirBest + ')');
}

/**
 * Duel to the Death — military duel; the opponent may dishonor the target to
 * refuse, otherwise the loser is DISCARDED FROM PLAY.
 *
 * Three branches, and which one happens is the opponent's choice:
 *   - target already dishonored → dishonor has no legal target, so refusal is
 *     impossible and the duel is forced. This is the card's best case and the
 *     reason it wants Game of Sadane in front of it.
 *   - refusing is cheaper for them → we collect the dishonor instead.
 *   - they duel → we win the body outright, or lose our own duellist.
 *
 * Because losing costs us a character, the challenger is chosen as the cheapest
 * body that still wins rather than the strongest.
 */
export function duelToTheDeathValue(ctx: CardValueContext, minWinProbability = 0.5): CardValue {
    if(ctx.conflictType !== 'military') {
        return blocked('military-only');
    }
    const killWorth = (card: ValuedCharacter) =>
        conflictSkillOf(card, 'military') + investedValue(card, ctx);
    const plan = projectDuel(ctx, {
        type: 'military',
        minWinProbability,
        challengerPolicy: 'risk',
        targetWorth: (card) => {
            const refusal = dishonorValue(ctx, card);
            // A target that cannot refuse is worth its whole body; one that can
            // is worth whichever branch the OPPONENT prefers, which is the
            // smaller of the two for us.
            return refusal.blocked
                ? killWorth(card)
                : Math.min(killWorth(card), refusal.skill + refusal.ability);
        }
    });
    if(!plan.target || !plan.challenger) {
        // `no-winnable-target` means we would probably lose, not that the play
        // is illegal, so it must not veto the card out of V1's pipeline.
        return plan.reason === 'no-winnable-target' ? hold(plan.reason) : blocked(plan.reason);
    }
    const refusal = dishonorValue(ctx, plan.target);
    const forced = !!refusal.blocked;
    const kill = killWorth(plan.target);
    const synergy = duelSynergyValue(ctx, { type: 'military', discardsLoser: true }, plan);

    if(!forced && (refusal.skill + refusal.ability) < kill * plan.odds.win) {
        // They will refuse: we take the dishonor and nothing else happens.
        return {
            selfSkill: 0,
            opponentSkill: -refusal.skill,
            abilityValue: refusal.ability,
            reason: 'refused:' + plan.target.id + '->' + refusal.reason
        };
    }
    const removed = conflictSkillOf(plan.target, 'military') * plan.odds.win;
    const risked = conflictSkillOf(plan.challenger, 'military') * plan.odds.loss;
    const ability = investedValue(plan.target, ctx) * plan.odds.win -
        investedValue(plan.challenger, ctx) * plan.odds.loss + synergy.ability;
    if(removed + ability <= 0) {
        return hold('duel-trade-negative');
    }
    return {
        selfSkill: Math.round((synergy.skill - risked) * 10) / 10,
        opponentSkill: -Math.round(removed * 10) / 10,
        abilityValue: Math.round(ability * 10) / 10,
        reason: (forced ? 'forced:' : 'duel:') + plan.challenger.id + '->' + plan.target.id +
            (synergy.detail.length > 0 ? '|' + synergy.detail.join('+') : '')
    };
}

/**
 * Challenge on the Fields — military duel where each duellist gets +1 for every
 * OTHER character its controller has in the conflict; the loser is sent home.
 *
 * The participant counts are the whole card: it is a removal spell when we
 * outnumber them and a way to lose our best body when we do not.
 */
export function challengeOnTheFieldsValue(ctx: CardValueContext, minWinProbability = 0.5): CardValue {
    if(ctx.conflictType !== 'military') {
        return blocked('military-only');
    }
    const mine = participating(ctx.myCharacters).length;
    const theirs = participating(ctx.opponentCharacters).length;
    if(mine === 0 || theirs === 0) {
        return blocked('no-participants');
    }
    const plan = projectDuel(ctx, {
        type: 'military',
        minWinProbability,
        myBonus: mine - 1,
        theirBonus: theirs - 1,
        targetWorth: (card) => conflictSkillOf(card, 'military')
    });
    if(!plan.target || !plan.challenger) {
        // `no-winnable-target` means we would probably lose, not that the play
        // is illegal, so it must not veto the card out of V1's pipeline.
        return plan.reason === 'no-winnable-target' ? hold(plan.reason) : blocked(plan.reason);
    }
    const removed = conflictSkillOf(plan.target, 'military') * plan.odds.win;
    const risked = conflictSkillOf(plan.challenger, 'military') * plan.odds.loss;
    if(removed <= 0) {
        return hold('target-contributes-nothing');
    }
    const synergy = duelSynergyValue(ctx, { type: 'military', sendsLoserHome: true }, plan);
    return {
        selfSkill: Math.round((synergy.skill - risked) * 10) / 10,
        opponentSkill: -Math.round(removed * 10) / 10,
        abilityValue: Math.round((3 + synergy.ability) * 10) / 10,
        reason: 'challenge:' + plan.challenger.id + '->' + plan.target.id + '(+' + (mine - 1) + '/+' + (theirs - 1) + ')'
    };
}

/**
 * Defend Your Honor — interrupt an opposing event with a military duel; if we
 * win, the event is cancelled.
 *
 * Same shape as Voice of Honor: worth exactly what it stops, and held back below
 * the threshold. The difference is the gate — instead of "do we control more
 * honored characters", it is "do we win the duel", and the OPPONENT chooses
 * which of their characters fights, so assume their best.
 */
export function defendYourHonorValue(
    ctx: CardValueContext,
    incomingValue = 0,
    threshold = 4,
    // Losing this duel costs NOTHING but the card - the cancel simply does not
    // happen - and an unplayed cancel is worth zero. Refusing at 50% therefore
    // threw the card away: measured, it skipped 39 of Dragon's plays at odds of
    // 12% and 40%. Only a duel we cannot win at all is worth declining.
    minWinProbability = 0
): CardValue {
    if(!ctx.activeConflict) {
        return blocked('not-during-conflict');
    }
    if(incomingValue < threshold) {
        return hold('incoming-below-threshold');
    }
    const plan = projectDuel(ctx, { type: 'military', theyPickTarget: true });
    if(!plan.target || !plan.challenger) {
        // `no-winnable-target` means we would probably lose, not that the play
        // is illegal, so it must not veto the card out of V1's pipeline.
        return plan.reason === 'no-winnable-target' ? hold(plan.reason) : blocked(plan.reason);
    }
    if(plan.odds.win <= minWinProbability) {
        return hold('duel-unwinnable-' + Math.round(plan.odds.win * 100));
    }
    const synergy = duelSynergyValue(ctx, { type: 'military' }, plan);
    return combine(plan, synergy, incomingValue * plan.odds.win, 'cancel-via-duel:' + plan.target.id);
}

/**
 * Insult to Injury — after our Duelist wins a duel, dishonor the loser.
 *
 * A pure dishonor payoff, so its whole value is `dishonorValue` on the character
 * that just lost — including whatever the dishonor then unlocks in hand.
 */
export function insultToInjuryValue(ctx: CardValueContext, loser?: ValuedCharacter): CardValue {
    const losers = new Set(ctx.duelLoserUuids || []);
    const target = loser || ctx.opponentCharacters
        .filter((card) => card.uuid && losers.has(card.uuid))
        .sort((a, b) => gloryOf(b) - gloryOf(a) || String(a.uuid).localeCompare(String(b.uuid)))[0];
    if(!target) {
        return blocked('no-duel-loser');
    }
    const value = dishonorValue(ctx, target);
    if(value.blocked) {
        return blocked(value.reason);
    }
    if(value.skill + value.ability <= 0) {
        return hold('dishonor-worthless');
    }
    return {
        selfSkill: 0,
        opponentSkill: -value.skill,
        abilityValue: value.ability,
        reason: value.reason
    };
}

/**
 * Iaijutsu Master — 1 fate, +1/+1, Duelist only, and changes our bid by 1 after
 * dials are revealed during a duel.
 *
 * The stat line alone is worse than Fine Katana's free +2 military. What makes
 * it better is the bid, which is worth a point of duel margin — but only when
 * there are duels to fight, so the ability half scales with the duel cards we
 * are actually holding and can pay for.
 */
export function iaijutsuMasterValue(ctx: CardValueContext): CardValue {
    const bearers = ctx.myCharacters.filter((card) => hasTrait(card, 'duelist'));
    if(bearers.length === 0) {
        return blocked('no-duelist-bearer');
    }
    const best = bearers.slice().sort((a, b) =>
        Number(contributesToConflict(b)) - Number(contributesToConflict(a)) ||
        skillOf(b, ctx.conflictType) - skillOf(a, ctx.conflictType) ||
        String(a.uuid).localeCompare(String(b.uuid)))[0];
    if((best.attachments || []).some((attachment) => attachment.id === 'iaijutsu-master')) {
        return blocked('already-attached');
    }
    const live = contributesToConflict(best) ? 1 : 0;
    const duels = duelCardsInHand(ctx).length;
    return {
        selfSkill: live,
        opponentSkill: 0,
        // Base 3 puts it above a bare +2 attachment even with no duel in hand,
        // because the +1 applies on BOTH skills and persists.
        abilityValue: 3 + Math.min(6, duels * 2),
        reason: 'attach:' + best.id + '(duels:' + duels + ')'
    };
}
