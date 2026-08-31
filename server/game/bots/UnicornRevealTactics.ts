/**
 * Two related things, both about province information.
 *
 * `ProvinceRevealResponseTactics` answers a province reveal for ANY deck: the
 * generic "they just flipped something, does it change our attack" reaction.
 *
 * `UnicornRevealTactics` is the Unicorn reveal-engine overlay, and it inverts
 * the normal targeting instinct: this deck prefers a still-HIDDEN province
 * even when it is stronger, because flipping it grows Shiro Shinjo and turns
 * on Scouted Terrain. `ProvinceKnowledge` / `ProvinceKnowledgeSnapshot` are
 * the fair (not omniscient) view — what the bot could legitimately have
 * observed being revealed.
 *
 * See `docs/unicorn-reveal-bot.md`.
 */
import type { ProvinceAbilityClass } from './ProvinceTargeting';

export interface ProvinceKnowledge {
    id?: string;
    location: string;
    owner: string;
    faceup: boolean;
    broken: boolean;
    stronghold: boolean;
    strength?: number;
    abilityClass?: ProvinceAbilityClass;
}

export interface ProvinceKnowledgeSnapshot {
    self: ProvinceKnowledge[];
    opponent: ProvinceKnowledge[];
    opponentStrongholdAttackable: boolean;
    // OUR stronghold province is legal to attack, i.e. their next conflict can
    // end the game. Read from the engine's own `ProvinceCard.canBeAttacked`,
    // never from a count of broken provinces: the rule is "more than TWO
    // broken", which is three, and a card could move it.
    selfStrongholdAttackable: boolean;
    combinedConflictSkills: boolean;
}

// The two states in which waiting for the opponent's attack cannot pay, so the
// bait's wait is skipped. See `shouldPlayScoutedTerrain`.
export interface ScoutedBaitEscape {
    ownStrongholdAttackable: boolean;
    opponentConflictsRemaining: number;
    // The declaration after this action window is OURS. Load bearing for both
    // escapes: if THEY declare next, their conflict completes and the bait's
    // own `scoutedMinimumOpponentCompletedConflicts` gate opens by itself one
    // conflict later — so playing early buys nothing and can only lose the
    // fate. Measured: without this, 6 of 9 escape plays bought no stronghold
    // declaration at all.
    ownDeclarationNext: boolean;
}

export interface ProvinceRevealResponseProfile {
    // Revealing one province denies Aranat one fate. Only reveal when the
    // province's immediate payoff is worth more than that denial.
    aranatFateDenialValue: number;
    onRevealValueById: Record<string, number>;
    fallbackValueByAbility: Record<ProvinceAbilityClass, number>;
}

// What the board can put into the stronghold attack Scouted Terrain unlocks.
export interface ScoutedAttackReadiness {
    conflictsRemaining: number;
    readyAttackers: number;
    readyAttackSkill: number;
}

export interface UnicornRevealProfile {
    // Which of the opponent's hidden provinces a reveal source flips FIRST.
    // Every payoff this deck buys with a reveal counts the OUTER four and
    // nothing else: Shiro Shinjo pays 1 fate per faceup NON-stronghold
    // province, Iuchi Daiyu's Action reads the same count, and the Scouted
    // Terrain gate below wants all four outer provinces faceup. Flipping the
    // stronghold province pays none of them, so it is taken LAST — by which
    // point it is the only hidden province left and the ordering is moot.
    // Live 2026-08-30 r1: Border Fortress revealed the stronghold province
    // while three outer provinces were still hidden, and Daiyu's Action read
    // +1 for the rest of that conflict.
    preferOpponentStrongholdReveal: boolean;
    revealSourceIds: string[];
    // Chasing the Sun, Diversionary Maneuver and Overrun all read "... and
    // reveal it, if able", and all three offer FACEUP opposing provinces
    // alongside facedown ones. Only the faceup ones carry a uuid in the bot's
    // view, so the generic enemy-side pick always landed on one and the reveal
    // half of the card did nothing at all. `pickRevealTarget` already ranks
    // hidden above faceup; it simply never receives a hidden province. This
    // makes the hidden one win before that ranking is reached.
    preferFacedownRevealTarget: boolean;
    // Sources whose payoff is BLANKING a province, not flipping it. Overrun
    // places a dishonored status token ("treat its printed text box as blank")
    // and reveals it as a rider. `ProvinceCard.isBlank()` already returns true
    // for a BROKEN province and a broken province is already faceup, so both
    // halves of the card are spent on the province the break just happened at
    // -- which is exactly what the hidden-first ranking below picks when every
    // opposing province is already faceup, because its last tie-break is the
    // alphabetical location string and 'province 1' sorts first (live
    // 2026-08-31: Overrun blanked the City of the Rich Frog it had just
    // broken). For these sources the STRONGHOLD province is the target: it is
    // the wall the game ends on, `ProvinceCard.canBeAttacked` makes the
    // opponent reach it last so its text has the longest left to run, and it
    // is the one province an attack plan cannot route around.
    blankAndRevealSourceIds: string[];
    redirectSourceIds: string[];
    firstConflictCharacterIds: string[];
    unrevealedProvinceAttackerIds: string[];
    // White Horde Vanguard's protection really is first-conflict-only, but the
    // reveal reactions (Trailblazer, Way Station Trader, Ganzu Warrior) fire in
    // ANY conflict where a facedown province is attacked. Gating both lists on
    // the first conflict left those bodies idle for conflicts 2-3, which is
    // where most reveals happen. Worth +0.21 to +0.26pp, positive in all four
    // measurements taken (two at p < 0.05); see docs/unicorn-reveal-bot.md.
    revealAttackerPriorityAllConflicts: boolean;
    additionalFateByCharacterId: Record<string, number>;
    provinceTextPriorityById: Record<string, number>;
    goodOmenCardId: string;
    laterRoundGoodOmenBidReduction: number;
    // Good Omen buys ONE extra round of life: the token it places is spent by
    // the next fate phase, and a character only leaves play when its fate
    // reaches zero there. On a body still sitting on fate the card therefore
    // buys nothing that was going to happen anyway (live 2026-08-24 r2c0: the
    // bot placed it on an Aranat holding five fate). Only a character at or
    // below this many fate is a real target.
    goodOmenMaxTargetFate: number;
    scoutedTerrainCardId: string;
    scoutedTerrainCost: number;
    // How many conflicts the OPPONENT must have completed this phase before the
    // card is played. Ships at 1, which is the bait in `defenderDecision`: let
    // their attack bow their bodies, keep ours ready by declining the defense,
    // then open the stronghold into a board that cannot defend it. Owner's
    // call 2026-08-30, after the alternative was built and measured.
    //
    // Its known cost, for whoever revisits this: the wait is on a conflict the
    // opponent is never obliged to declare. Live 2026-08-30 r4 — first player,
    // two copies in hand, 9 fate, three ready bodies (19 military) against a
    // known strength-5 stronghold province, all four outer provinces faceup —
    // every other leg of `shouldPlayScoutedTerrain` passed and this one alone
    // refused; the opponent's first conflict of that phase broke our stronghold
    // province and ended the game. Setting this to 0 was built, tested and
    // censused (24 -> 44 plays, 24 -> 33 converted into a stronghold
    // declaration, 0 -> 11 paid for nothing over 64 games) and is still a
    // one-value arm. See docs/unicorn-reveal-bot.md.
    //
    // The two escapes below keep the bait and remove the states in which it
    // cannot pay.
    scoutedMinimumOpponentCompletedConflicts: number;
    // Three of OUR provinces are broken, so the conflict the bait is waiting
    // for may be the one that ends the game — as it was in that replay. Play
    // now: breaking their stronghold province wins outright, and nothing is
    // preserved by waiting for an attack that can get there first. Scoped to
    // a declaration that is ours (`ScoutedBaitEscape.ownDeclarationNext`).
    scoutedIgnoreWaitWhenOwnStrongholdAtRisk: boolean;
    // They have no conflict opportunity left this phase, so the attack the
    // bait is waiting for cannot happen at all and the card sits in hand while
    // four fate stay reserved for it.
    scoutedIgnoreWaitWhenOpponentOutOfConflicts: boolean;
    // Scouted Terrain buys exactly ONE thing: a legal declaration against the
    // stronghold province. It has no board effect, no card draw and no fate
    // return, so a phase in which we never declare that attack spends four
    // fate and a card on nothing. A human replay (2026-08-22 vs Crab) played
    // it three times and declared at the stronghold zero times: twice the
    // declaration went to a cheap outer province, once the phase had no ready
    // character at all. Both gates below are that replay.
    scoutedRequiresReadyAttacker: boolean;
    // Even unopposed, an attack that cannot reach the stronghold province's
    // strength cannot break it, and breaking it is the only payoff. Skill on
    // ready bodies is compared against the province, not against the
    // defenders: the opponent may decline to defend, and the deck's pumps sit
    // on top of this floor.
    scoutedRequireBreakableStronghold: boolean;
    // What to assume when the stronghold province is still facedown. Fair
    // seeds cannot read its strength, and the card's own condition already
    // needs four faceup opposing provinces before it is playable.
    scoutedUnknownStrongholdStrength: number;
    // Headroom demanded over the province strength before the line is worth
    // the card. 0 = break it exactly if nobody defends.
    scoutedStrongholdSkillMargin: number;
    // Once the stronghold province is legal, target it. The generic province
    // ranking prefers the CHEAPEST break, which throws the card away.
    scoutedDeclareAtStronghold: boolean;
    // Characters whose printed skill IS the fate left in our pool (Yoritomo).
    // Bought out of an opening 6-fate pool they arrive as a vanilla 3/3 tower
    // on an empty board, which is the opposite of what the reveal engine wants
    // early: several bodies, several declarations, several flips.
    fateScalingCharacterIds: string[];
    // Fate that must remain in the pool AFTER paying the cost and the extra
    // fate this deck puts on the body. Below it, the buy is declined.
    fateScalingMinimumPoolAfterPlay: number;
    // The gate lifts once this many of the opponent's outer provinces are
    // faceup: at that point the board is wide enough, the pool is being fed by
    // Shiro Shinjo, and one big body is the better use of the fate.
    fateScalingWideBoardRevealedProvinces: number;
}

export const PROVINCE_REVEAL_RESPONSE_DEFAULTS: ProvinceRevealResponseProfile = {
    aranatFateDenialValue: 2,
    // These are immediate reveal payoffs. Action-only provinces intentionally
    // remain below the threshold: exposing one merely makes Shiro Shinjo pay.
    onRevealValueById: {
        'khan-s-ordu': 5,
        'offerings-to-the-kami': 5,
        'retire-to-the-brotherhood': 5,
        'sacred-sanctuary': 4,
        'endless-plains': 3,
        'elemental-fury': 3,
        'night-raid': 3,
        'pilgrimage': 2.5
    },
    fallbackValueByAbility: {
        none: 0,
        action: 0.5,
        reaction: 2.5,
        reveal: 3,
        unknown: 0
    }
};

export const UNICORN_REVEAL_DEFAULTS: UnicornRevealProfile = {
    preferOpponentStrongholdReveal: false,
    revealSourceIds: [
        'border-fortress', 'iuchi-farseer', 'chasing-the-sun',
        'diversionary-maneuver', 'overrun'
    ],
    preferFacedownRevealTarget: true,
    blankAndRevealSourceIds: ['overrun'],
    redirectSourceIds: ['chasing-the-sun', 'diversionary-maneuver'],
    firstConflictCharacterIds: ['white-horde-vanguard'],
    // Every character here has a reveal-triggered reaction that needs it
    // PARTICIPATING when the province flips, so all three want to be in an
    // attack on a facedown province.
    unrevealedProvinceAttackerIds: ['shinjo-trailblazer', 'way-station-trader', 'ganzu-warrior'],
    revealAttackerPriorityAllConflicts: true,
    // Benefactor must enter dire. The larger characters are the long-game fate
    // bank; Audience Chamber adds one more fate after cost 4+ plays.
    additionalFateByCharacterId: {
        'khanbulak-benefactor': 0,
        'way-station-trader': 1,
        'shinjo-trailblazer': 1,
        'ganzu-warrior': 1,
        'iuchi-farseer': 1,
        'iuchi-daiyu': 2,
        'moto-horde': 2,
        'white-horde-vanguard': 2,
        'kudaka': 2,
        'higashi-kaze-company': 2,
        'moto-chagatai': 2,
        'yoritomo': 2,
        'aranat': 2
    },
    provinceTextPriorityById: {
        'massing-at-twilight': 10,
        'khan-s-ordu': 9,
        'appealing-to-the-fortunes': 8,
        'ancestral-lands': 7,
        'border-fortress': 6
    },
    goodOmenCardId: 'good-omen',
    laterRoundGoodOmenBidReduction: 1,
    goodOmenMaxTargetFate: 1,
    scoutedTerrainCardId: 'scouted-terrain',
    scoutedTerrainCost: 4,
    scoutedMinimumOpponentCompletedConflicts: 1,
    scoutedIgnoreWaitWhenOwnStrongholdAtRisk: true,
    scoutedIgnoreWaitWhenOpponentOutOfConflicts: true,
    scoutedRequiresReadyAttacker: true,
    scoutedRequireBreakableStronghold: true,
    scoutedUnknownStrongholdStrength: 5,
    scoutedStrongholdSkillMargin: 0,
    scoutedDeclareAtStronghold: true,
    fateScalingCharacterIds: ['yoritomo'],
    fateScalingMinimumPoolAfterPlay: 2,
    fateScalingWideBoardRevealedProvinces: 3
};

const rawSkill = (card: any, axis: 'military' | 'political'): number => {
    const summary = axis === 'military' ? card?.militarySkillSummary : card?.politicalSkillSummary;
    const value = Number(summary?.stat ?? card?.[axis]);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
};

const characterValue = (card: any): number =>
    rawSkill(card, 'military') + rawSkill(card, 'political') +
    (Number(card?.fate) || 0) * 2 + (Number(card?.printedCost ?? card?.cost) || 0);

export class ProvinceRevealResponseTactics {
    constructor(public readonly profile: ProvinceRevealResponseProfile = PROVINCE_REVEAL_RESPONSE_DEFAULTS) {}

    // What revealing this card is worth, from the profile table with a
    // generic fallback.
    value(card: any): number {
        const exact = Number(this.profile.onRevealValueById[String(card?.id || '')]);
        if(Number.isFinite(exact)) {
            return exact;
        }
        const ability = (card?.provinceAbilityClass || 'unknown') as ProvinceAbilityClass;
        return Number(this.profile.fallbackValueByAbility[ability]) || 0;
    }

    // Choice forced by Aranat, excluding the stronghold province.
    pickAgainstAranat(cards: any[]): any | null {
        return cards
            .filter((card) => !card?.selected && card?.location !== 'stronghold province')
            .map((card) => ({ card, value: this.value(card) }))
            .filter((entry) => entry.value > this.profile.aranatFateDenialValue)
            .sort((left, right) => right.value - left.value ||
                String(left.card?.location || '').localeCompare(String(right.card?.location || '')))[0]?.card || null;
    }
}

export class UnicornRevealTactics {
    constructor(public readonly profile: UnicornRevealProfile = UNICORN_REVEAL_DEFAULTS) {}

    // How many of their outer provinces we have already seen.
    opponentFaceupNonStronghold(snapshot?: ProvinceKnowledgeSnapshot): number {
        return snapshot?.opponent.filter((province) => province.faceup && !province.stronghold).length || 0;
    }

    // All four outer provinces revealed — the reveal engine has nothing left
    // to flip.
    allOpponentOuterRevealed(snapshot?: ProvinceKnowledgeSnapshot): boolean {
        return this.opponentFaceupNonStronghold(snapshot) >= 4;
    }

    // Their stronghold province as the fair view sees it, and the strength we
    // have to reach to break it. A facedown one falls back to the profile
    // assumption rather than to zero, so an unknown province cannot look free.
    strongholdBreakStrength(snapshot?: ProvinceKnowledgeSnapshot): number {
        const stronghold = snapshot?.opponent.find((province) => province.stronghold);
        const strength = Number(stronghold?.strength);
        return stronghold?.faceup && Number.isFinite(strength)
            ? Math.max(0, strength)
            : Math.max(0, this.profile.scoutedUnknownStrongholdStrength);
    }

    // Can the bodies that are ready RIGHT NOW break the stronghold province if
    // nobody defends? `readyAttackSkill` is their summed skill on the axis the
    // declaration would use.
    canBreakStrongholdNow(snapshot: ProvinceKnowledgeSnapshot | undefined, readyAttackSkill: number): boolean {
        return Math.max(0, Number(readyAttackSkill) || 0) >=
            this.strongholdBreakStrength(snapshot) + this.profile.scoutedStrongholdSkillMargin;
    }

    // Is the bait's wait pointless in this exact state? It waits for a conflict
    // the opponent is never obliged to declare, so there are two boards on
    // which waiting cannot pay and one of them loses the game.
    //
    // The default escape is deliberately inert: an omitted argument reports an
    // opponent with conflicts left and our own stronghold province safe, which
    // is the pre-escape behaviour exactly.
    // Returns WHICH escape opened, not a boolean: the two fail independently
    // and a census that cannot tell them apart cannot retire one of them.
    baitWaitIsPointless(escape?: ScoutedBaitEscape): 'own-stronghold' | 'opponent-out' | null {
        // Skipping the wait is only worth anything when we are the one about to
        // declare. If they declare next, waiting costs us nothing: their
        // conflict opens the gate the bait is waiting on.
        if(!escape?.ownDeclarationNext) {
            return null;
        }
        if(this.profile.scoutedIgnoreWaitWhenOwnStrongholdAtRisk && escape.ownStrongholdAttackable) {
            return 'own-stronghold';
        }
        const remaining = Number(escape.opponentConflictsRemaining);
        return this.profile.scoutedIgnoreWaitWhenOpponentOutOfConflicts &&
            Number.isFinite(remaining) && Math.max(0, remaining) < 1
            ? 'opponent-out'
            : null;
    }

    // Scouted Terrain needs unrevealed provinces to pay off, so it is gated on
    // the snapshot rather than on fate alone.
    //
    // It also needs the attack it enables to actually happen. The lasting
    // effect expires at end of phase and grants nothing else, so a conflict
    // opportunity, a body that can be declared, and enough skill to reach the
    // province are all part of the card's cost, not of its follow-up.
    //
    // `escape` only ever RELAXES the completed-conflicts wait. Every other leg
    // still has to pass, so an escape can never spend the card on an attack
    // that cannot be declared or cannot reach the province.
    shouldPlayScoutedTerrain(
        snapshot: ProvinceKnowledgeSnapshot | undefined,
        fate: number,
        opponentCompletedConflicts: number,
        attack: ScoutedAttackReadiness = { conflictsRemaining: 1, readyAttackers: 1, readyAttackSkill: Infinity },
        escape?: ScoutedBaitEscape
    ): boolean {
        if(!snapshot || snapshot.opponentStrongholdAttackable ||
            !this.allOpponentOuterRevealed(snapshot) || fate < this.profile.scoutedTerrainCost) {
            return false;
        }
        if(opponentCompletedConflicts < this.profile.scoutedMinimumOpponentCompletedConflicts &&
            this.baitWaitIsPointless(escape) === null) {
            return false;
        }
        if(this.profile.scoutedRequiresReadyAttacker &&
            (Math.max(0, Number(attack.conflictsRemaining) || 0) < 1 ||
                Math.max(0, Number(attack.readyAttackers) || 0) < 1)) {
            return false;
        }
        return !this.profile.scoutedRequireBreakableStronghold ||
            this.canBreakStrongholdNow(snapshot, attack.readyAttackSkill);
    }

    // Layer this deck's Good Omen consideration on top of the generic draw
    // bid, from round 2 onward.
    adjustDrawBid(baseBid: number, roundNumber: number, hand: any[]): number {
        if(roundNumber <= 1 || !hand.some((card) => card?.id === this.profile.goodOmenCardId)) {
            return baseBid;
        }
        return Math.max(1, baseBid - this.profile.laterRoundGoodOmenBidReduction);
    }

    // Per-character extra-fate table; null defers to the generic economy.
    desiredAdditionalFate(cardId?: string): number | null {
        if(!cardId || !Object.prototype.hasOwnProperty.call(this.profile.additionalFateByCharacterId, cardId)) {
            return null;
        }
        return Math.max(0, Number(this.profile.additionalFateByCharacterId[cardId]) || 0);
    }

    // Most valuable character overall, by combined skill, fate and cost.
    pickStrongestCharacter(cards: any[]): any | null {
        return cards.filter((card) => card?.type === 'character')
            .sort((left, right) => characterValue(right) - characterValue(left) ||
                String(left?.uuid || '').localeCompare(String(right?.uuid || '')))[0] || null;
    }

    // Is this body worth a Good Omen at all — i.e. is it close enough to
    // leaving play that one more fate changes whether it survives?
    isGoodOmenTarget(card: any): boolean {
        return card?.type === 'character' &&
            (Number(card?.fate) || 0) <= Math.max(0, Number(this.profile.goodOmenMaxTargetFate) || 0);
    }

    // Which body takes the Good Omen. `pickStrongestCharacter` cannot answer
    // this: its value term counts fate at DOUBLE weight, so the fattest
    // character on the board — the one that needs the token least — always
    // won. Rank the qualifying bodies without that term.
    pickGoodOmenTarget(cards: any[]): any | null {
        const value = (card: any) => characterValue(card) - (Number(card?.fate) || 0) * 2;
        return cards.filter((card) => this.isGoodOmenTarget(card))
            .sort((left, right) => value(right) - value(left) ||
                String(left?.uuid || '').localeCompare(String(right?.uuid || '')))[0] || null;
    }

    // Best ready participant to buff on the military axis.
    pickMilitaryBuffTarget(cards: any[]): any | null {
        return cards.filter((card) => card?.type === 'character' && card.inConflict && !card.bowed)
            .sort((left, right) => rawSkill(right, 'military') - rawSkill(left, 'military') ||
                characterValue(right) - characterValue(left))[0] || null;
    }

    // Highest current-conflict skill among legal ready Outflank targets.
    pickOutflankTarget(cards: any[], axis: 'military' | 'political'): any | null {
        return cards.filter((card) => card?.type === 'character' && !card.bowed && !card.isUnique)
            .sort((left, right) => rawSkill(right, axis) - rawSkill(left, axis) ||
                characterValue(right) - characterValue(left) ||
                String(left?.uuid || '').localeCompare(String(right?.uuid || '')))[0] || null;
    }

    // Which province to flip — this deck wants provinces revealed, so a
    // still-hidden one can outrank a weaker faceup one.
    //
    // `sourceId` is optional so every legacy caller keeps the old ordering; it
    // only selects the blank-and-reveal branch below.
    pickRevealTarget(cards: any[], sourceId?: string): any | null {
        // Provinces only. `ProvinceCard.hideWhenFacedown()` is false, so even a
        // facedown province publishes `type: 'province'` — the loose
        // `card?.facedown` test that used to be here also swept in the facedown
        // DYNASTY cards sitting in those provinces, which no reveal source can
        // target.
        const candidates = cards.filter((card) => card?.type === 'province' || card?.isProvince)
            // A broken province is already faceup AND already blank
            // (`ProvinceCard.isBlank()` returns true while `isBroken`), so
            // every half of every source in `revealSourceIds` is a no-op on it.
            .filter((card) => !card?.isBroken);
        const isStronghold = (card: any) => Number(card?.location === 'stronghold province');
        if(this.profile.blankAndRevealSourceIds.includes(String(sourceId || ''))) {
            // Blanking is the payoff and the reveal is the rider, so the order
            // inverts: the stronghold province first, then a still-hidden
            // province (blanking it also kills its on-reveal reaction, because
            // the token lands BEFORE the flip), then printed-text priority. A
            // province already carrying the token has nothing left to blank.
            return candidates.sort((left, right) =>
                Number(!!left.isDishonored) - Number(!!right.isDishonored) ||
                isStronghold(right) - isStronghold(left) ||
                Number(!!right.facedown) - Number(!!left.facedown) ||
                this.provinceTextValue(right) - this.provinceTextValue(left) ||
                String(left?.location || '').localeCompare(String(right?.location || '')))[0] || null;
        }
        return candidates.sort((left, right) => {
            const leftHidden = Number(!!left.facedown);
            const rightHidden = Number(!!right.facedown);
            if(leftHidden !== rightHidden) {
                return rightHidden - leftHidden;
            }
            // Explicit in BOTH directions. Falling through to the location
            // string happens to sort 'province N' before 'stronghold
            // province', but that is an accident of the alphabet and the text
            // priority below it can override it.
            //
            // Scoped to hidden candidates: this term is about which flip is
            // worth more, and a faceup province has no flip left to spend. A
            // source whose other half BLANKS a province takes the
            // `blankAndRevealSourceIds` branch above instead.
            if(left.facedown && right.facedown) {
                const stronghold = this.profile.preferOpponentStrongholdReveal
                    ? isStronghold(right) - isStronghold(left)
                    : isStronghold(left) - isStronghold(right);
                if(stronghold !== 0) {
                    return stronghold;
                }
            }
            return this.provinceTextValue(right) - this.provinceTextValue(left) ||
                String(left?.location || '').localeCompare(String(right?.location || ''));
        })[0] || null;
    }

    private provinceTextValue(card: any): number {
        return Number(this.profile.provinceTextPriorityById[card?.id]) || 0;
    }

    // Yoritomo's whole body is the fate we did NOT spend. Buying him down to
    // an empty pool pays 5-6 fate for a 3/3, so decline while the pool cannot
    // hold `fateScalingMinimumPoolAfterPlay` afterwards AND the reveal engine
    // still wants width. `additionalFate` is what this deck would put on him;
    // it is capped by what is actually left after the cost, the same way the
    // additional-fate prompt caps it.
    shouldPlayFateScalingCharacter(
        cardId: string | undefined,
        fate: number,
        cost: number,
        snapshot?: ProvinceKnowledgeSnapshot
    ): boolean {
        if(!cardId || !this.profile.fateScalingCharacterIds.includes(cardId)) {
            return true;
        }
        if(this.opponentFaceupNonStronghold(snapshot) >= this.profile.fateScalingWideBoardRevealedProvinces) {
            return true;
        }
        const afterCost = Math.max(0, (Number(fate) || 0) - Math.max(0, Number(cost) || 0));
        const additional = Math.min(this.desiredAdditionalFate(cardId) ?? 0, afterCost);
        return afterCost - additional >= this.profile.fateScalingMinimumPoolAfterPlay;
    }

    // Per-card trigger conditions for the deck's reveal payoffs.
    shouldTrigger(cardId: string, opponentFate: number, snapshot?: ProvinceKnowledgeSnapshot): boolean {
        if(cardId === 'way-station-trader') {
            return opponentFate >= 1;
        }
        if(cardId === 'shiro-shinjo') {
            return this.opponentFaceupNonStronghold(snapshot) >= 1;
        }
        return true;
    }
}
