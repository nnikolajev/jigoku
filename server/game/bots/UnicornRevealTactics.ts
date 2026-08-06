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
    combinedConflictSkills: boolean;
}

export interface ProvinceRevealResponseProfile {
    // Revealing one province denies Aranat one fate. Only reveal when the
    // province's immediate payoff is worth more than that denial.
    aranatFateDenialValue: number;
    onRevealValueById: Record<string, number>;
    fallbackValueByAbility: Record<ProvinceAbilityClass, number>;
}

export interface UnicornRevealProfile {
    preferOpponentStrongholdReveal: boolean;
    revealSourceIds: string[];
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
    scoutedTerrainCardId: string;
    scoutedTerrainCost: number;
    scoutedMinimumOpponentCompletedConflicts: number;
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
    preferOpponentStrongholdReveal: true,
    revealSourceIds: [
        'border-fortress', 'iuchi-farseer', 'chasing-the-sun',
        'diversionary-maneuver', 'overrun'
    ],
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
    scoutedTerrainCardId: 'scouted-terrain',
    scoutedTerrainCost: 4,
    scoutedMinimumOpponentCompletedConflicts: 1
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

    value(card: any): number {
        const exact = Number(this.profile.onRevealValueById[String(card?.id || '')]);
        if(Number.isFinite(exact)) {
            return exact;
        }
        const ability = (card?.provinceAbilityClass || 'unknown') as ProvinceAbilityClass;
        return Number(this.profile.fallbackValueByAbility[ability]) || 0;
    }

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

    opponentFaceupNonStronghold(snapshot?: ProvinceKnowledgeSnapshot): number {
        return snapshot?.opponent.filter((province) => province.faceup && !province.stronghold).length || 0;
    }

    opponentFacedownNonStronghold(snapshot?: ProvinceKnowledgeSnapshot): number {
        return snapshot?.opponent.filter((province) => !province.faceup && !province.stronghold && !province.broken).length || 0;
    }

    allOpponentOuterRevealed(snapshot?: ProvinceKnowledgeSnapshot): boolean {
        return this.opponentFaceupNonStronghold(snapshot) >= 4;
    }

    shouldPlayScoutedTerrain(
        snapshot: ProvinceKnowledgeSnapshot | undefined,
        fate: number,
        opponentCompletedConflicts: number
    ): boolean {
        return !!snapshot && !snapshot.opponentStrongholdAttackable &&
            this.allOpponentOuterRevealed(snapshot) && fate >= this.profile.scoutedTerrainCost &&
            opponentCompletedConflicts >= this.profile.scoutedMinimumOpponentCompletedConflicts;
    }

    adjustDrawBid(baseBid: number, roundNumber: number, hand: any[]): number {
        if(roundNumber <= 1 || !hand.some((card) => card?.id === this.profile.goodOmenCardId)) {
            return baseBid;
        }
        return Math.max(1, baseBid - this.profile.laterRoundGoodOmenBidReduction);
    }

    desiredAdditionalFate(cardId?: string): number | null {
        if(!cardId || !Object.prototype.hasOwnProperty.call(this.profile.additionalFateByCharacterId, cardId)) {
            return null;
        }
        return Math.max(0, Number(this.profile.additionalFateByCharacterId[cardId]) || 0);
    }

    pickStrongestCharacter(cards: any[]): any | null {
        return cards.filter((card) => card?.type === 'character')
            .sort((left, right) => characterValue(right) - characterValue(left) ||
                String(left?.uuid || '').localeCompare(String(right?.uuid || '')))[0] || null;
    }

    pickMilitaryBuffTarget(cards: any[]): any | null {
        return cards.filter((card) => card?.type === 'character' && card.inConflict && !card.bowed)
            .sort((left, right) => rawSkill(right, 'military') - rawSkill(left, 'military') ||
                characterValue(right) - characterValue(left))[0] || null;
    }

    pickOutflankTarget(cards: any[]): any | null {
        return cards.filter((card) => card?.type === 'character' && !card.bowed && !card.isUnique)
            .sort((left, right) => characterValue(right) - characterValue(left))[0] || null;
    }

    pickRevealTarget(cards: any[]): any | null {
        const candidates = cards.filter((card) => card?.type === 'province' || card?.isProvince || card?.facedown);
        return candidates.sort((left, right) => {
            const leftHidden = Number(!!left.facedown);
            const rightHidden = Number(!!right.facedown);
            if(leftHidden !== rightHidden) {
                return rightHidden - leftHidden;
            }
            if(this.profile.preferOpponentStrongholdReveal) {
                const stronghold = Number(right.location === 'stronghold province') -
                    Number(left.location === 'stronghold province');
                if(stronghold !== 0) {
                    return stronghold;
                }
            }
            const textValue = (card: any) => Number(this.profile.provinceTextPriorityById[card?.id]) || 0;
            return textValue(right) - textValue(left) ||
                String(left?.location || '').localeCompare(String(right?.location || ''));
        })[0] || null;
    }

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
