const OUTER_PROVINCE_KEYS = ['one', 'two', 'three', 'four'];

export const BROKEN_PROVINCES_TO_ATTACK_STRONGHOLD = 3;

export type ProvinceAbilityClass = 'none' | 'reveal' | 'reaction' | 'action' | 'unknown';

export interface ProvinceTargetingProfile {
    // Eminent provinces start faceup and are normally deliberately weaker.
    preferEminent: boolean;
    // Fair bots use this only for still-hidden provinces. Seed 3 supplies the
    // exact value through KnownProvinceTarget.
    unknownStrength: number;
    // Lower value means earlier target within equal Eminent/strength groups.
    abilityPriority: Record<ProvinceAbilityClass, number>;
    // A province may require more work than its printed strength suggests.
    // Public Forum prevents its first break, so one conquest effectively costs
    // two strength-3 breaks. This value affects target order only, never the
    // engine's live breaking calculation.
    effectiveStrengthById: Record<string, number>;
    // Leading injectable tier. Negative attacks earlier; positive attacks
    // later. Deck profiles can move an unusually valuable/dangerous province
    // ahead of or behind every generic rule without duplicating this sorter.
    priorityTierById: Record<string, number>;
}

export const PROVINCE_TARGETING_DEFAULTS: ProvinceTargetingProfile = {
    preferEminent: true,
    unknownStrength: 4,
    abilityPriority: {
        none: 0,
        reveal: 1,
        reaction: 2,
        action: 3,
        unknown: 4
    },
    effectiveStrengthById: {
        'public-forum': 6
    },
    priorityTierById: {}
};

export interface KnownProvinceTarget {
    location: string;
    id?: string;
    name?: string;
    strength: number;
    broken?: boolean;
    facedown?: boolean;
    eminent?: boolean;
    abilityClass?: ProvinceAbilityClass;
}

interface RankedProvinceList {
    list: any[];
    index: number;
    tier: number;
    eminent: number;
    strength: number;
    ability: number;
}

/** Shared, injectable target ordering for every bot seed. */
export class ProvinceTargetingTactics {
    constructor(private profile: ProvinceTargetingProfile = PROVINCE_TARGETING_DEFAULTS) {}

    rank(candidateLists: any[][], known: KnownProvinceTarget[] = []): any[][] {
        return candidateLists
            .map((list, index) => this.describe(list, index, known))
            .sort((left, right) =>
                (left.tier - right.tier) ||
                (left.eminent - right.eminent) ||
                (left.strength - right.strength) ||
                (left.ability - right.ability) ||
                (left.index - right.index))
            .map((entry) => entry.list);
    }

    private describe(list: any[], index: number, known: KnownProvinceTarget[]): RankedProvinceList {
        const card = (list || []).find((candidate: any) =>
            candidate && candidate.isProvince !== false &&
            (candidate.isProvince || candidate.type === 'province' || candidate.facedown));
        const exact = card?.location
            ? known.find((candidate) => candidate.location === card.location)
            : undefined;
        const id = String(exact?.id || card?.id || this.idFromName(exact?.name || card?.name) || '');
        const visibleStrength = Number(card?.strengthSummary?.stat);
        const exactStrength = Number(exact?.strength);
        const rawStrength = Number.isFinite(exactStrength) ? exactStrength :
            (Number.isFinite(visibleStrength) ? visibleStrength : this.profile.unknownStrength);
        const strengthOverride = Number(this.profile.effectiveStrengthById[id]);
        const strength = Number.isFinite(strengthOverride) ? strengthOverride : rawStrength;
        const abilityClass = exact?.abilityClass || card?.provinceAbilityClass || 'unknown';
        const ability = Number(this.profile.abilityPriority[abilityClass]);
        const eminent = !!(exact?.eminent ?? card?.eminent);

        return {
            list,
            index,
            tier: Number(this.profile.priorityTierById[id]) || 0,
            eminent: this.profile.preferEminent && eminent ? 0 : 1,
            strength,
            ability: Number.isFinite(ability) ? ability : this.profile.abilityPriority.unknown
        };
    }

    private idFromName(name?: string): string {
        return String(name || '').trim().toLowerCase()
            .replace(/[\u2018\u2019']/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
}

function outerProvinceLists(player: any): any[][] {
    return OUTER_PROVINCE_KEYS.map((key) => player?.provinces?.[key] || []);
}

function isProvinceCard(card: any): boolean {
    return !!card && card.isProvince !== false &&
        (card.isProvince || card.type === 'province' || card.facedown);
}

export function brokenOuterProvinceCount(player: any): number {
    return outerProvinceLists(player).filter((list) =>
        (list || []).some((card: any) => isProvinceCard(card) && card.isBroken)).length;
}

export function mustAttackStronghold(player: any): boolean {
    if(brokenOuterProvinceCount(player) < BROKEN_PROVINCES_TO_ATTACK_STRONGHOLD) {
        return false;
    }

    return (player?.strongholdProvince || []).some((card: any) =>
        isProvinceCard(card) && !card.isBroken && card.type !== 'stronghold');
}

// Legal conquest progression is shared by every bot brain: attack outer
// provinces until three break, then ignore the fourth outer province and attack
// only the stronghold province. Breaking that province wins the game.
// Paired deterministic A/B, Scorpion vs Crane seed 1, N=400 (2026-07-14):
// current rule 78.75% Scorpion; legacy Scorpion behavior only 78.5%; legacy
// Crane targeting only 91.75%; legacy Crane commitment only 79.75%. The drop
// came from Crane no longer wasting a conflict on the fourth province, not from
// Scorpion harming itself. Do not add a Scorpion exception.
export function attackProvinceLists(player: any): any[][] {
    return mustAttackStronghold(player)
        ? [player?.strongholdProvince || []]
        : outerProvinceLists(player);
}

export function strongholdProvinceUnderAttack(player: any): boolean {
    return (player?.strongholdProvince || []).some((card: any) =>
        isProvinceCard(card) && card.inConflict && !card.isBroken && card.type !== 'stronghold');
}
