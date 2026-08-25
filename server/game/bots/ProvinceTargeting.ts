/**
 * Chooses which province to attack, and in what order over a game.
 *
 * Three broken provinces open the stronghold (`BROKEN_PROVINCES_TO_ATTACK_STRONGHOLD`),
 * so target ORDER is a whole-game plan rather than a per-conflict pick. The
 * ranking prefers Eminent (faceup by rule, therefore usually deliberately
 * weak) and low effective strength.
 *
 * `effectiveStrengthById` is where printed strength lies: Public Forum
 * prevents its own first break, so one conquest there really costs two
 * strength-3 breaks. That table adjusts target ORDER only — it never touches
 * the engine's live break calculation.
 *
 * Fair bots must estimate a facedown province through `unknownStrength`; an
 * omniscient seat supplies the true value via `KnownProvinceTarget`.
 */
const OUTER_PROVINCE_KEYS = ['one', 'two', 'three', 'four'];

const BROKEN_PROVINCES_TO_ATTACK_STRONGHOLD = 3;

export type ProvinceAbilityClass = 'none' | 'reveal' | 'reaction' | 'action' | 'unknown';

export interface ProvinceTargetingProfile {
    // Eminent provinces start faceup and are normally deliberately weaker.
    preferEminent: boolean;
    // Reveal-engine decks prefer a still-hidden province even when it is
    // stronger: flipping it grows Shiro Shinjo and enables Scouted Terrain.
    preferFacedown: boolean;
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
    // Omniscient-only tie/tradeoff: valuable hidden dynasty stacks make a
    // location cheaper to target because a break also denies those cards.
    // `cap` prevents one stack from overriding grossly stronger provinces.
    hiddenDynastyDenialWeight: number;
    hiddenDynastyDenialCap: number;
    // PUBLIC-information targeting. Everything below is legal for a fair bot:
    // whether a province is still facedown, and which dynasty cards are sitting
    // faceup in it, are both visible to both players.
    //
    // A revealed province cannot spring its reveal effect on the attacker, so
    // it is worth attacking at a strength premium. Expressed as a discount off
    // effective strength rather than a sort tier, so the preference can be
    // anything from a tie-break (small) to absolute (large).
    faceupProvinceDiscount: number;
    // Breaking a province lets the attacker discard the dynasty cards in it, so
    // an unbought character waiting there is a reason to attack that location.
    // Fed by `denialByLocation`, which the controller computes from faceup
    // cards only — the hidden-stack version above stays omniscient-only.
    faceupDynastyDenialWeight: number;
    faceupDynastyDenialCap: number;
    // A faceup holding raises the strength of the province it sits in. Against
    // a province still FACEDOWN that bonus is the only strength signal either
    // player has, so it is added to `unknownStrength` rather than guessed at.
    faceupHoldingStrengthWeight: number;
}

export const PROVINCE_TARGETING_DEFAULTS: ProvinceTargetingProfile = {
    preferEminent: true,
    preferFacedown: false,
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
    priorityTierById: {},
    hiddenDynastyDenialWeight: 1,
    hiddenDynastyDenialCap: 6,
    // All off: `describe` adds nothing and the ordering is V1's.
    faceupProvinceDiscount: 0,
    faceupDynastyDenialWeight: 0,
    faceupDynastyDenialCap: 6,
    faceupHoldingStrengthWeight: 0
};

export interface FaceupProvinceInfo {
    denial: number;
    holdingStrength: number;
}

export interface KnownProvinceTarget {
    location: string;
    id?: string;
    name?: string;
    strength: number;
    broken?: boolean;
    facedown?: boolean;
    eminent?: boolean;
    abilityClass?: ProvinceAbilityClass;
    dynastyCardIds?: string[];
    dynastyValue?: number;
}

interface RankedProvinceList {
    list: any[];
    index: number;
    tier: number;
    eminent: number;
    facedown: number;
    strength: number;
    ability: number;
}

/** Shared, injectable target ordering for every bot seed. */
export class ProvinceTargetingTactics {
    constructor(private profile: ProvinceTargetingProfile = PROVINCE_TARGETING_DEFAULTS) {}

    rank(candidateLists: any[][], known: KnownProvinceTarget[] = [],
        denialByLocation: Record<string, FaceupProvinceInfo> = {}): any[][] {
        return candidateLists
            .map((list, index) => this.describe(list, index, known, denialByLocation))
            .sort((left, right) =>
                (left.tier - right.tier) ||
                (left.facedown - right.facedown) ||
                (left.eminent - right.eminent) ||
                (left.strength - right.strength) ||
                (left.ability - right.ability) ||
                (left.index - right.index))
            .map((entry) => entry.list);
    }

    private describe(list: any[], index: number, known: KnownProvinceTarget[],
        denialByLocation: Record<string, FaceupProvinceInfo> = {}): RankedProvinceList {
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
        const effectiveStrength = Number.isFinite(strengthOverride) ? strengthOverride : rawStrength;
        const denial = Math.min(
            Math.max(0, Number(exact?.dynastyValue) || 0) * Math.max(0, this.profile.hiddenDynastyDenialWeight),
            Math.max(0, this.profile.hiddenDynastyDenialCap)
        );
        const abilityClass = exact?.abilityClass || card?.provinceAbilityClass || 'unknown';
        const ability = Number(this.profile.abilityPriority[abilityClass]);
        const eminent = !!(exact?.eminent ?? card?.eminent);
        const facedown = !!(exact?.facedown ?? card?.facedown);
        const faceup = denialByLocation[String(card?.location || '')];
        const faceupDenial = Math.min(
            Math.max(0, Number(faceup?.denial) || 0) *
                Math.max(0, this.profile.faceupDynastyDenialWeight),
            Math.max(0, this.profile.faceupDynastyDenialCap)
        );
        // Only for a facedown province: a revealed one already carries its
        // holdings in `strengthSummary`, so adding them again would double-count.
        const holdingStrength = facedown
            ? Math.max(0, Number(faceup?.holdingStrength) || 0) *
                this.profile.faceupHoldingStrengthWeight
            : 0;
        const strength = effectiveStrength - denial - faceupDenial + holdingStrength -
            (facedown ? 0 : this.profile.faceupProvinceDiscount);

        return {
            list,
            index,
            tier: Number(this.profile.priorityTierById[id]) || 0,
            facedown: this.profile.preferFacedown && facedown ? 0 : 1,
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
