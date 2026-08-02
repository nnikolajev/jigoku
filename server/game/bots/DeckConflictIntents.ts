import type {
    ConflictAxis,
    ConflictDeclarationOption,
    ConflictDefenseOption,
    ConflictPlannerCharacter,
    ConflictPlannerOpportunities,
    ConflictPlannerTarget
} from './ConflictPhasePlanner';

/**
 * Deck-authored conflict declaration rules.
 *
 * Bot V2 is tuned exactly like Bot V1: a heuristic engine whose deck-specific
 * knowledge lives in injectable per-deck data, not in the base class. This
 * module is that surface for the CONFLICT PHASE. A deck says what it wants
 * (which conflict type, which ring, which bodies must be in, which bodies stay
 * home); the base `ConflictPhasePlanner` scores every proposal inside the same
 * phase rollout and executes the best whole-phase SEQUENCE.
 *
 * See `docs/bot-v2-deck-tuning.md`.
 */
export interface DeckConflictIntentRule {
    /** Stable id, also the trace reason suffix. */
    id: string;

    // ---- what the deck wants declared ----
    axis?: ConflictAxis;
    /** Preferred ring elements, best first. One option is emitted per element. */
    ringElements?: string[];
    /** Bonus lost per position down the `ringElements` list. */
    ringBonusStep?: number;
    /** Printed card ids that MUST participate; a missing/bowed one retires the rule. */
    requiredCardIds?: string[];
    /** Instead of naming cards: require the N best ready bodies with these traits. */
    requiredTraits?: string[];
    requiredTraitCount?: number;
    /** Printed card ids kept OUT of this declaration (movement engines, walls). */
    reserveCardIds?: string[];
    /** Keep back the N weakest ready bodies carrying these traits. */
    reserveTraits?: string[];
    reserveCount?: number;
    /** Send exactly the required bodies (solo-attacker cards). */
    exactAttackers?: boolean;

    // ---- how confident the deck is ----
    /** Added to this branch's rollout score. Deck confidence, not a hard order. */
    bonus?: number;
    /** Retire the rule when the phase it produces scores below this. */
    minScore?: number;
    /**
     * Restrict to one declaration slot counted from the decision being made
     * now (0 = the next declaration). Not an index from the start of the
     * round: the planner only ever sees the opportunities that REMAIN.
     */
    declarationIndex?: number;

    // ---- when the rule is offered at all ----
    minRound?: number;
    maxRound?: number;
    /** Every id must be in play (any controller-side body of ours). */
    requireCardIdsInPlay?: string[];
    /** At least one of these must be in hand (payoff cards like For Greater Glory). */
    requireHandCardIds?: string[];
    /** Minimum ready bodies of our own. */
    requireReadyCount?: number;
    /** Our own ready skill on the rule's axis must reach this. */
    minAxisSkill?: number;
    requireOpponentBrokenAtLeast?: number;
    requireSelfBrokenAtMost?: number;
    minHonor?: number;
    maxHonor?: number;
    minOpponentHonor?: number;
    maxOpponentHonor?: number;
    reason?: string;
}

/**
 * A deck's defense policy for a conflict declared against it.
 *
 * Defending is a trade, not a duty: every defender bows, so a province saved
 * on the opponent's conflict can cost us our own. The deck says which bodies
 * it cares about and when it would rather keep the board; the base planner
 * scores each proposal against the rest of the phase and decides.
 */
export interface DeckDefenseIntentRule {
    id: string;

    // ---- when the rule is offered ----
    /** Only when defending this conflict type. */
    axis?: ConflictAxis;
    /** Only when one of these rings is contested. */
    ringElements?: string[];
    /** Only when the attacked province is (or is not) the stronghold. */
    strongholdProvince?: boolean;
    /** Only while the attacker's committed skill is at most this. */
    maxAttackerSkill?: number;
    /** Only once the attacker's committed skill reaches this. */
    minAttackerSkill?: number;
    /** Only when we still have at least this many conflicts of our own left. */
    minOwnConflictsRemaining?: number;
    /** Only when the break cannot be stopped by everything we could commit. */
    whenBreakInevitable?: boolean;
    minRound?: number;
    maxRound?: number;
    minHonor?: number;
    maxHonor?: number;
    requireCardIdsInPlay?: string[];
    requireHandCardIds?: string[];
    requireSelfBrokenAtMost?: number;
    requireSelfBrokenAtLeast?: number;

    // ---- what the deck wants ----
    /** These bodies must be in the defense (walls, on-defense payoffs). */
    requiredCardIds?: string[];
    requiredTraits?: string[];
    requiredTraitCount?: number;
    /** These bodies stay home for our own conflict. */
    reserveCardIds?: string[];
    reserveTraits?: string[];
    reserveCount?: number;
    /** Defend with exactly the required bodies. */
    exactDefenders?: boolean;
    /** Give the conflict up and keep the board ready. */
    concede?: boolean;
    /** Deck confidence, added to this branch's score. */
    bonus?: number;
    reason?: string;
}

export interface ConflictIntentProfile {
    enabled: boolean;
    rules: DeckConflictIntentRule[];
    /** Defense rules are gated separately so a deck can tune one side only. */
    defenseEnabled?: boolean;
    defenseRules?: DeckDefenseIntentRule[];
}

export const DEFAULT_CONFLICT_INTENTS: ConflictIntentProfile = {
    enabled: false,
    rules: [],
    defenseEnabled: false,
    defenseRules: []
};

/** Everything a deck rule may gate on. Built once per declaration decision. */
export interface ConflictIntentContext {
    round: number;
    selfCharacters: ConflictPlannerCharacter[];
    handCardIds: string[];
    ringElements: string[];
    targets: ConflictPlannerTarget[];
    opportunities: ConflictPlannerOpportunities;
    selfBrokenProvinces: number;
    opponentBrokenProvinces: number;
    honor: number;
    opponentHonor: number;
    fate: number;
}

/** The live conflict a defense rule is being offered against. */
export interface DefenseIntentContext {
    axis: ConflictAxis;
    ringElement?: string;
    targetStronghold?: boolean;
    attackerSkill: number;
    /** True when even committing everything cannot stop the break. */
    breakInevitable?: boolean;
}

const AXES: ConflictAxis[] = ['military', 'political'];

export class DeckConflictIntents {
    constructor(readonly profile: ConflictIntentProfile = DEFAULT_CONFLICT_INTENTS) {}

    /** Resolve the deck's rules into concrete options for this board. */
    build(context: ConflictIntentContext): ConflictDeclarationOption[] {
        if(!this.profile?.enabled || !(this.profile.rules || []).length) {
            return [];
        }
        const options: ConflictDeclarationOption[] = [];
        for(const rule of this.profile.rules) {
            if(!this.gatesPass(rule, context)) {
                continue;
            }
            const required = this.requiredUuids(rule, context);
            if(required === null) {
                continue;
            }
            const reserve = this.reserveUuids(rule, context, new Set(required));
            const elements = (rule.ringElements || []).filter((element) =>
                context.ringElements.includes(element));
            const step = Number.isFinite(rule.ringBonusStep) ? Number(rule.ringBonusStep) : 0.5;
            const base: Omit<ConflictDeclarationOption, 'id'> = {
                axis: rule.axis,
                requiredAttackerUuids: required.length > 0 ? required : undefined,
                reserveUuids: reserve.length > 0 ? reserve : undefined,
                exactAttackers: rule.exactAttackers,
                minScore: rule.minScore,
                declarationIndex: rule.declarationIndex,
                reason: rule.reason || `conflict-intent-${rule.id}`
            };
            if((rule.ringElements || []).length > 0 && elements.length === 0) {
                // The deck asked for specific rings and none are available;
                // its ringless fallback (if any) is a separate rule.
                continue;
            }
            if(elements.length === 0) {
                options.push({ ...base, id: rule.id, bonus: Number(rule.bonus) || 0 });
                continue;
            }
            elements.forEach((element, index) => {
                options.push({
                    ...base,
                    id: `${rule.id}:${element}`,
                    ringElement: element,
                    bonus: (Number(rule.bonus) || 0) - index * step,
                    reason: rule.reason || `conflict-intent-${rule.id}-${element}`
                });
            });
        }
        return options;
    }

    /** Resolve the deck's defense rules for the conflict declared against us. */
    buildDefense(context: ConflictIntentContext,
        live: DefenseIntentContext): ConflictDefenseOption[] {
        if(!this.profile?.defenseEnabled || !(this.profile.defenseRules || []).length) {
            return [];
        }
        const options: ConflictDefenseOption[] = [];
        for(const rule of this.profile.defenseRules!) {
            if(!this.defenseGatesPass(rule, context, live)) {
                continue;
            }
            const required = this.requiredUuids({
                id: rule.id,
                axis: live.axis,
                requiredCardIds: rule.requiredCardIds,
                requiredTraits: rule.requiredTraits,
                requiredTraitCount: rule.requiredTraitCount
            }, context);
            if(required === null) {
                continue;
            }
            const reserve = this.reserveUuids({
                id: rule.id,
                axis: live.axis,
                reserveCardIds: rule.reserveCardIds,
                reserveTraits: rule.reserveTraits,
                reserveCount: rule.reserveCount
            }, context, new Set(required));
            options.push({
                id: rule.id,
                requiredDefenderUuids: required.length > 0 ? required : undefined,
                reserveUuids: reserve.length > 0 ? reserve : undefined,
                exactDefenders: rule.exactDefenders,
                concede: rule.concede,
                bonus: Number(rule.bonus) || 0,
                reason: rule.reason || `defense-intent-${rule.id}`
            });
        }
        return options;
    }

    private defenseGatesPass(rule: DeckDefenseIntentRule, context: ConflictIntentContext,
        live: DefenseIntentContext): boolean {
        if(rule.axis && rule.axis !== live.axis) return false;
        if((rule.ringElements || []).length > 0 &&
            (!live.ringElement || !rule.ringElements!.includes(live.ringElement))) return false;
        if(rule.strongholdProvince !== undefined &&
            rule.strongholdProvince !== !!live.targetStronghold) return false;
        if(Number.isFinite(rule.maxAttackerSkill) &&
            live.attackerSkill > Number(rule.maxAttackerSkill)) return false;
        if(Number.isFinite(rule.minAttackerSkill) &&
            live.attackerSkill < Number(rule.minAttackerSkill)) return false;
        if(Number.isFinite(rule.minOwnConflictsRemaining) &&
            context.opportunities.total < Number(rule.minOwnConflictsRemaining)) return false;
        if(rule.whenBreakInevitable !== undefined &&
            rule.whenBreakInevitable !== !!live.breakInevitable) return false;
        if(Number.isFinite(rule.minRound) && context.round < Number(rule.minRound)) return false;
        if(Number.isFinite(rule.maxRound) && context.round > Number(rule.maxRound)) return false;
        if(Number.isFinite(rule.minHonor) && context.honor < Number(rule.minHonor)) return false;
        if(Number.isFinite(rule.maxHonor) && context.honor > Number(rule.maxHonor)) return false;
        if(Number.isFinite(rule.requireSelfBrokenAtMost) &&
            context.selfBrokenProvinces > Number(rule.requireSelfBrokenAtMost)) return false;
        if(Number.isFinite(rule.requireSelfBrokenAtLeast) &&
            context.selfBrokenProvinces < Number(rule.requireSelfBrokenAtLeast)) return false;
        if((rule.requireHandCardIds || []).length > 0 &&
            !rule.requireHandCardIds!.some((id) => context.handCardIds.includes(id))) return false;
        if((rule.requireCardIdsInPlay || []).length > 0) {
            const inPlay = new Set(context.selfCharacters.map((card) => card.cardId).filter(Boolean));
            if(!rule.requireCardIdsInPlay!.every((id) => inPlay.has(id))) return false;
        }
        return true;
    }

    private gatesPass(rule: DeckConflictIntentRule, context: ConflictIntentContext): boolean {
        if(Number.isFinite(rule.minRound) && context.round < Number(rule.minRound)) return false;
        if(Number.isFinite(rule.maxRound) && context.round > Number(rule.maxRound)) return false;
        if(Number.isFinite(rule.minHonor) && context.honor < Number(rule.minHonor)) return false;
        if(Number.isFinite(rule.maxHonor) && context.honor > Number(rule.maxHonor)) return false;
        if(Number.isFinite(rule.minOpponentHonor) &&
            context.opponentHonor < Number(rule.minOpponentHonor)) return false;
        if(Number.isFinite(rule.maxOpponentHonor) &&
            context.opponentHonor > Number(rule.maxOpponentHonor)) return false;
        if(Number.isFinite(rule.requireOpponentBrokenAtLeast) &&
            context.opponentBrokenProvinces < Number(rule.requireOpponentBrokenAtLeast)) return false;
        if(Number.isFinite(rule.requireSelfBrokenAtMost) &&
            context.selfBrokenProvinces > Number(rule.requireSelfBrokenAtMost)) return false;

        const ready = context.selfCharacters.filter((card) => card.ready);
        if(Number.isFinite(rule.requireReadyCount) && ready.length < Number(rule.requireReadyCount)) {
            return false;
        }
        if((rule.requireHandCardIds || []).length > 0 &&
            !rule.requireHandCardIds!.some((id) => context.handCardIds.includes(id))) {
            return false;
        }
        if((rule.requireCardIdsInPlay || []).length > 0) {
            const inPlay = new Set(context.selfCharacters.map((card) => card.cardId).filter(Boolean));
            if(!rule.requireCardIdsInPlay!.every((id) => inPlay.has(id))) {
                return false;
            }
        }
        if(Number.isFinite(rule.minAxisSkill)) {
            const axes = rule.axis ? [rule.axis] : AXES;
            const best = Math.max(...axes.map((axis) => ready
                .filter((card) => this.legalOn(card, axis))
                .reduce((sum, card) => sum + Math.max(0, Number(card[axis]) || 0), 0)));
            if(best < Number(rule.minAxisSkill)) {
                return false;
            }
        }
        return true;
    }

    /** null = a named requirement is unavailable, so the rule is retired. */
    private requiredUuids(rule: DeckConflictIntentRule, context: ConflictIntentContext): string[] | null {
        const ready = context.selfCharacters.filter((card) => card.ready);
        const uuids: string[] = [];
        for(const cardId of rule.requiredCardIds || []) {
            const match = ready.find((card) => card.cardId === cardId);
            if(!match) {
                return null;
            }
            uuids.push(match.uuid);
        }
        const traitCount = Math.max(0, Math.floor(Number(rule.requiredTraitCount) || 0));
        if((rule.requiredTraits || []).length > 0 && traitCount > 0) {
            const axis: ConflictAxis = rule.axis || 'military';
            const pool = ready
                .filter((card) => !uuids.includes(card.uuid) && this.hasTrait(card, rule.requiredTraits!))
                .sort((left, right) => (Number(right[axis]) || 0) - (Number(left[axis]) || 0) ||
                    left.uuid.localeCompare(right.uuid));
            if(pool.length < traitCount) {
                return null;
            }
            uuids.push(...pool.slice(0, traitCount).map((card) => card.uuid));
        }
        return uuids;
    }

    private reserveUuids(rule: DeckConflictIntentRule, context: ConflictIntentContext,
        required: Set<string>): string[] {
        const allReady = context.selfCharacters.filter((card) => card.ready);
        const ready = allReady.filter((card) => !required.has(card.uuid));
        const uuids = new Set<string>();
        for(const cardId of rule.reserveCardIds || []) {
            for(const card of ready.filter((candidate) => candidate.cardId === cardId)) {
                uuids.add(card.uuid);
            }
        }
        const count = Math.max(0, Math.floor(Number(rule.reserveCount) || 0));
        if(count > 0) {
            const axis: ConflictAxis = rule.axis || 'military';
            const traits = rule.reserveTraits || [];
            const pool = ready
                .filter((card) => !uuids.has(card.uuid) &&
                    (traits.length === 0 || this.hasTrait(card, traits)))
                // Hold back the LEAST useful bodies on the attacking axis: the
                // reserve exists to keep a blocker / mover home, not to bench
                // the deck's best attacker.
                .sort((left, right) => (Number(left[axis]) || 0) - (Number(right[axis]) || 0) ||
                    left.uuid.localeCompare(right.uuid));
            // Never reserve so much that nothing is left to declare with. The
            // bodies the rule REQUIRES still count as available, so they are
            // included in the headroom.
            const allowed = Math.max(0, Math.min(count, allReady.length - 1));
            for(const card of pool.slice(0, allowed)) {
                uuids.add(card.uuid);
            }
        }
        return [...uuids];
    }

    private hasTrait(card: ConflictPlannerCharacter, traits: string[]): boolean {
        const own = (card.traits || []).map((trait) => String(trait).toLowerCase());
        return traits.some((trait) => own.includes(String(trait).toLowerCase()));
    }

    private legalOn(card: ConflictPlannerCharacter, axis: ConflictAxis): boolean {
        return axis === 'military' ? card.legalMilitary !== false : card.legalPolitical !== false;
    }
}

export default DeckConflictIntents;
