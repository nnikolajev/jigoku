export type ConflictAxis = 'military' | 'political';
export type ConflictPlanningPolicyVariant = 'lookahead' | 'legacy';

export interface ConflictPhasePlannerProfile {
    enabled: boolean;
    maxDepth: number;
    maxAttackSets: number;
    maxAttackChoices: number;
    maxRingChoices: number;
    discount: number;
    aggression: number;
    conflictWinValue: number;
    provinceBreakValue: number;
    strongholdBreakValue: number;
    unopposedValue: number;
    ringFateValue: number;
    ringEffectValue: number;
    claimedRingValue: number;
    readySkillValue: number;
    passPenalty: number;
    dynastyProjectionWeight: number;
    preserveOtherAxisWeight: number;
    applyPassPlan: boolean;
    applyRingPlan: boolean;
    applyTypePlan: boolean;
    applyTargetPlan: boolean;
    applyDynastyProjection: boolean;
    applyAttackerPlan: boolean;
}

export const DEFAULT_CONFLICT_PHASE_PLANNER: ConflictPhasePlannerProfile = {
    enabled: true,
    maxDepth: 5,
    maxAttackSets: 5,
    maxAttackChoices: 18,
    maxRingChoices: 3,
    discount: 0.9,
    aggression: 1,
    conflictWinValue: 2.5,
    provinceBreakValue: 9,
    strongholdBreakValue: 500,
    unopposedValue: 1.25,
    ringFateValue: 2.5,
    ringEffectValue: 0.2,
    claimedRingValue: 0.6,
    readySkillValue: 0.12,
    passPenalty: 3,
    dynastyProjectionWeight: 0.35,
    preserveOtherAxisWeight: 0.45,
    applyPassPlan: false,
    applyRingPlan: false,
    applyTypePlan: false,
    applyTargetPlan: true,
    applyDynastyProjection: false,
    // Existing live commitment logic understands card-specific solo attacks,
    // movement engines and stronghold reserves. The retained rollout guides
    // sequential province targets; profiles may opt into the other layers
    // once their archetype has no richer declaration rule.
    applyAttackerPlan: false
};

export const RUSH_CONFLICT_PHASE_PLANNER: ConflictPhasePlannerProfile = {
    ...DEFAULT_CONFLICT_PHASE_PLANNER,
    aggression: 1.3,
    conflictWinValue: 3,
    provinceBreakValue: 11,
    passPenalty: 3,
    readySkillValue: 0.08,
    preserveOtherAxisWeight: 0.25,
    applyPassPlan: false,
    applyRingPlan: false,
    applyTypePlan: false,
    applyTargetPlan: true,
    applyDynastyProjection: false,
    applyAttackerPlan: false
};

export interface ConflictPlannerCharacter {
    uuid: string;
    military: number;
    political: number;
    ready: boolean;
    inConflict?: boolean;
    legalMilitary?: boolean;
    legalPolitical?: boolean;
    covert?: boolean;
    bowsAfterConflict?: boolean;
}

export interface ConflictPlannerOpportunities {
    total: number;
    military: number;
    political: number;
}

export interface ConflictPlannerRing {
    element: string;
    fate: number;
    selfValue: number;
    opponentValue: number;
}

export interface ConflictPlannerTarget {
    location: string;
    strength: number;
    stronghold?: boolean;
    priority?: number;
}

export interface ConflictPlannerHandThreat {
    military: number;
    political: number;
}

export interface ConflictPhasePlannerInput {
    selfCharacters: ConflictPlannerCharacter[];
    opponentCharacters: ConflictPlannerCharacter[];
    selfOpportunities: ConflictPlannerOpportunities;
    opponentOpportunities: ConflictPlannerOpportunities;
    rings: ConflictPlannerRing[];
    selfTargets: ConflictPlannerTarget[];
    opponentTargets: ConflictPlannerTarget[];
    selfBrokenProvinces: number;
    opponentBrokenProvinces: number;
    actor?: 'self' | 'opponent';
    selfHandThreat?: Partial<ConflictPlannerHandThreat>;
    opponentHandThreat?: Partial<ConflictPlannerHandThreat>;
    lockedAxis?: ConflictAxis;
    lockedRingElement?: string;
    lockedTargetLocation?: string;
    forcedAttackerUuids?: string[];
}

export interface ConflictPhasePlanStep {
    actor: 'self' | 'opponent';
    action: 'attack' | 'pass';
    axis?: ConflictAxis;
    ringElement?: string;
    targetLocation?: string;
    attackerUuids?: string[];
    defenderUuids?: string[];
    conflictWon?: boolean;
    provinceBroken?: boolean;
    score: number;
}

export interface ConflictPhasePlan {
    action: 'attack' | 'pass';
    conflictType?: ConflictAxis;
    ringElement?: string;
    targetLocation?: string;
    attackerUuids: string[];
    score: number;
    sequence: ConflictPhasePlanStep[];
    reason: string;
}

interface SearchState {
    selfReady: Set<string>;
    opponentReady: Set<string>;
    selfOpportunities: ConflictPlannerOpportunities;
    opponentOpportunities: ConflictPlannerOpportunities;
    rings: ConflictPlannerRing[];
    selfTargets: ConflictPlannerTarget[];
    opponentTargets: ConflictPlannerTarget[];
    selfBroken: number;
    opponentBroken: number;
    actor: 'self' | 'opponent';
    depth: number;
}

interface SearchResult {
    score: number;
    sequence: ConflictPhasePlanStep[];
}

interface AttackChoice {
    axis: ConflictAxis;
    ring: ConflictPlannerRing;
    target: ConflictPlannerTarget;
    attackers: ConflictPlannerCharacter[];
}

/**
 * Bounded, deterministic same-conflict-phase rollout. It intentionally models
 * declarations and their lasting costs (claimed rings, bowed attackers and
 * defenders, broken provinces, remaining typed/extra opportunities), not the
 * engine's full action stack. Existing card-specific tactics still own live
 * conflict actions; their affordable skill is supplied as a bounded threat.
 */
export class ConflictPhasePlanner {
    constructor(readonly profile: ConflictPhasePlannerProfile = DEFAULT_CONFLICT_PHASE_PLANNER) {}

    plan(input: ConflictPhasePlannerInput): ConflictPhasePlan {
        if(!this.profile.enabled || input.selfOpportunities.total <= 0) {
            return this.passPlan(0, 'conflict-lookahead-disabled-or-empty');
        }

        const state: SearchState = {
            selfReady: new Set(input.selfCharacters.filter((card) => card.ready).map((card) => card.uuid)),
            opponentReady: new Set(input.opponentCharacters.filter((card) => card.ready).map((card) => card.uuid)),
            selfOpportunities: this.copyOpportunities(input.selfOpportunities),
            opponentOpportunities: this.copyOpportunities(input.opponentOpportunities),
            rings: input.rings.map((ring) => ({ ...ring })),
            selfTargets: input.selfTargets.map((target) => ({ ...target })),
            opponentTargets: input.opponentTargets.map((target) => ({ ...target })),
            selfBroken: input.selfBrokenProvinces,
            opponentBroken: input.opponentBrokenProvinces,
            actor: input.actor || 'self',
            depth: 0
        };
        const result = this.search(state, input, new Map());
        const first = result.sequence.find((step) => step.actor === 'self');
        if(!first || first.action === 'pass') {
            return this.passPlan(result.score, 'conflict-lookahead-pass');
        }
        return {
            action: 'attack',
            conflictType: first.axis,
            ringElement: first.ringElement,
            targetLocation: first.targetLocation,
            attackerUuids: first.attackerUuids || [],
            score: result.score,
            sequence: result.sequence,
            reason: 'conflict-lookahead-attack'
        };
    }

    /** Score a projected dynasty board using a fresh two-conflict phase. */
    projectBoard(input: ConflictPhasePlannerInput): number {
        const projected: ConflictPhasePlannerInput = {
            ...input,
            actor: 'self',
            lockedAxis: undefined,
            lockedRingElement: undefined,
            lockedTargetLocation: undefined,
            forcedAttackerUuids: undefined
        };
        return this.plan(projected).score * this.profile.dynastyProjectionWeight;
    }

    private search(state: SearchState, input: ConflictPhasePlannerInput,
        memo: Map<string, SearchResult>): SearchResult {
        const stateWithActor = this.advanceActor(state);
        if(stateWithActor.depth >= this.profile.maxDepth || stateWithActor.rings.length === 0 ||
            (stateWithActor.selfOpportunities.total <= 0 && stateWithActor.opponentOpportunities.total <= 0)) {
            return { score: this.terminalValue(stateWithActor, input), sequence: [] };
        }
        const key = this.stateKey(stateWithActor);
        const cached = memo.get(key);
        if(cached) {
            return cached;
        }

        const actor = stateWithActor.actor;
        const choices = this.attackChoices(stateWithActor, input);
        const candidates: SearchResult[] = [];
        for(const choice of choices) {
            candidates.push(this.evaluateAttack(stateWithActor, input, choice, memo));
        }
        candidates.push(this.evaluatePass(stateWithActor, input, memo));
        const result = candidates.sort((left, right) => actor === 'self'
            ? right.score - left.score
            : left.score - right.score)[0];
        memo.set(key, result);
        return result;
    }

    private evaluateAttack(state: SearchState, input: ConflictPhasePlannerInput,
        choice: AttackChoice, memo: Map<string, SearchResult>): SearchResult {
        const actor = state.actor;
        const defender = actor === 'self' ? 'opponent' : 'self';
        const defenders = this.availableCharacters(state, input, defender, choice.axis)
            .filter((card) => !choice.attackers.some((attacker) => attacker.uuid === card.uuid));
        const covert = choice.attackers.filter((card) => card.covert).length;
        const uncovertable = defenders.slice().sort((a, b) =>
            this.skill(b, choice.axis) - this.skill(a, choice.axis)).slice(covert);
        const defenseSets = this.usefulSets(uncovertable, choice.axis, [], true);
        const outcomes = defenseSets.map((defense) => {
            const next = this.cloneState(state);
            const actorReady = actor === 'self' ? next.selfReady : next.opponentReady;
            const defenderReady = defender === 'self' ? next.selfReady : next.opponentReady;
            for(const card of choice.attackers) {
                if(card.bowsAfterConflict !== false) {
                    actorReady.delete(card.uuid);
                }
            }
            for(const card of defense) {
                if(card.bowsAfterConflict !== false) {
                    defenderReady.delete(card.uuid);
                }
            }
            this.spendOpportunity(actor === 'self' ? next.selfOpportunities : next.opponentOpportunities,
                choice.axis);
            next.rings = next.rings.filter((ring) => ring.element !== choice.ring.element);
            const attackSkill = choice.attackers.reduce((sum, card) => sum + this.skill(card, choice.axis), 0) +
                this.handThreat(input, actor, choice.axis);
            const defenseSkill = defense.reduce((sum, card) => sum + this.skill(card, choice.axis), 0) +
                this.handThreat(input, defender, choice.axis);
            // Engine rule: attacker wins a nonzero tie. Only 0-0 has no
            // winner (`Conflict.determineWinner`).
            const attackerWon = attackSkill >= defenseSkill && attackSkill > 0;
            const broke = attackerWon && attackSkill - defenseSkill >= choice.target.strength;
            if(broke) {
                if(actor === 'self') {
                    next.opponentTargets = next.opponentTargets.filter((target) => target.location !== choice.target.location);
                    if(!choice.target.stronghold) {
                        next.opponentBroken++;
                    }
                } else {
                    next.selfTargets = next.selfTargets.filter((target) => target.location !== choice.target.location);
                    if(!choice.target.stronghold) {
                        next.selfBroken++;
                    }
                }
            }
            next.actor = defender;
            next.depth++;
            const immediate = this.immediateValue(actor, choice, defense, attackerWon, broke);
            const tail = choice.target.stronghold && broke
                ? { score: 0, sequence: [] as ConflictPhasePlanStep[] }
                : this.search(next, input, memo);
            const signedImmediate = actor === 'self' ? immediate : -immediate;
            const score = signedImmediate + this.profile.discount * tail.score;
            const step: ConflictPhasePlanStep = {
                actor,
                action: 'attack',
                axis: choice.axis,
                ringElement: choice.ring.element,
                targetLocation: choice.target.location,
                attackerUuids: choice.attackers.map((card) => card.uuid),
                defenderUuids: defense.map((card) => card.uuid),
                conflictWon: attackerWon,
                provinceBroken: broke,
                score: signedImmediate
            };
            return { score, sequence: [step, ...tail.sequence] };
        });
        // Defender chooses its response: opponent minimizes bot score, bot maximizes.
        return outcomes.sort((left, right) => defender === 'self'
            ? right.score - left.score
            : left.score - right.score)[0];
    }

    private evaluatePass(state: SearchState, input: ConflictPhasePlannerInput,
        memo: Map<string, SearchResult>): SearchResult {
        const next = this.cloneState(state);
        const opportunities = state.actor === 'self' ? next.selfOpportunities : next.opponentOpportunities;
        opportunities.total = Math.max(0, opportunities.total - 1);
        next.actor = state.actor === 'self' ? 'opponent' : 'self';
        next.depth++;
        const tail = this.search(next, input, memo);
        const value = this.profile.passPenalty * this.profile.aggression;
        const signed = state.actor === 'self' ? -value : value;
        return {
            score: signed + this.profile.discount * tail.score,
            sequence: [{ actor: state.actor, action: 'pass', score: signed }, ...tail.sequence]
        };
    }

    private attackChoices(state: SearchState, input: ConflictPhasePlannerInput): AttackChoice[] {
        const actor = state.actor;
        const opportunities = actor === 'self' ? state.selfOpportunities : state.opponentOpportunities;
        const axes = (['military', 'political'] as ConflictAxis[]).filter((axis) =>
            opportunities.total > 0 && opportunities[axis] > 0 &&
            !(state.depth === 0 && actor === 'self' && input.lockedAxis && input.lockedAxis !== axis));
        const targetPool = actor === 'self' ? state.opponentTargets : state.selfTargets;
        const broken = actor === 'self' ? state.opponentBroken : state.selfBroken;
        const targets = this.legalTargets(targetPool, broken).filter((target) =>
            !(state.depth === 0 && actor === 'self' && input.lockedTargetLocation &&
                target.location !== input.lockedTargetLocation));
        if(targets.length === 0) {
            return [];
        }

        const ringChoices = state.rings.filter((ring) =>
            !(state.depth === 0 && actor === 'self' && input.lockedRingElement &&
                ring.element !== input.lockedRingElement))
            .sort((left, right) => actor === 'self'
                ? this.ringValue(right, actor) - this.ringValue(left, actor)
                : this.ringValue(right, actor) - this.ringValue(left, actor))
            .slice(0, Math.max(1, this.profile.maxRingChoices));
        const choices: AttackChoice[] = [];
        for(const axis of axes) {
            const available = this.availableCharacters(state, input, actor, axis);
            const forced = state.depth === 0 && actor === 'self'
                ? available.filter((card) => (input.forcedAttackerUuids || []).includes(card.uuid))
                : [];
            const sets = this.usefulSets(available, axis, forced, false);
            for(const target of targets.slice(0, 2)) {
                for(const ring of ringChoices) {
                    for(const attackers of sets) {
                        if(attackers.length > 0) {
                            choices.push({ axis, ring, target, attackers });
                        }
                    }
                }
            }
        }
        return choices
            .sort((left, right) => this.choiceHeuristic(state, input, right) -
                this.choiceHeuristic(state, input, left) ||
                left.axis.localeCompare(right.axis) ||
                left.ring.element.localeCompare(right.ring.element) ||
                left.attackers.map((card) => card.uuid).join(',')
                    .localeCompare(right.attackers.map((card) => card.uuid).join(',')))
            .slice(0, Math.max(1, this.profile.maxAttackChoices));
    }

    private choiceHeuristic(state: SearchState, input: ConflictPhasePlannerInput,
        choice: AttackChoice): number {
        const actor = state.actor;
        const defender = actor === 'self' ? 'opponent' : 'self';
        const attack = choice.attackers.reduce((sum, card) => sum + this.skill(card, choice.axis), 0) +
            this.handThreat(input, actor, choice.axis);
        const defenders = this.availableCharacters(state, input, defender, choice.axis)
            .slice()
            .sort((left, right) => this.skill(right, choice.axis) - this.skill(left, choice.axis));
        const covert = choice.attackers.filter((card) => card.covert).length;
        const defense = defenders.slice(covert)
            .reduce((sum, card) => sum + this.skill(card, choice.axis), 0) +
            this.handThreat(input, defender, choice.axis);
        const margin = attack - defense;
        const breakable = margin >= choice.target.strength;
        const other: ConflictAxis = choice.axis === 'military' ? 'political' : 'military';
        const futureCost = choice.attackers.reduce((sum, card) =>
            sum + this.skill(card, other) * this.profile.preserveOtherAxisWeight, 0);
        return (choice.target.stronghold && breakable ? this.profile.strongholdBreakValue : 0) +
            (breakable ? this.profile.provinceBreakValue * this.profile.aggression : 0) +
            this.ringValue(choice.ring, actor) + choice.ring.fate * this.profile.ringFateValue +
            margin * 0.2 - futureCost * 0.15 - choice.attackers.length * 0.05;
    }

    private usefulSets(cards: ConflictPlannerCharacter[], axis: ConflictAxis,
        forced: ConflictPlannerCharacter[], defending: boolean): ConflictPlannerCharacter[][] {
        const forcedIds = new Set(forced.map((card) => card.uuid));
        const optional = cards.filter((card) => !forcedIds.has(card.uuid));
        const other: ConflictAxis = axis === 'military' ? 'political' : 'military';
        const score = (card: ConflictPlannerCharacter) => this.skill(card, axis) -
            this.skill(card, other) * this.profile.preserveOtherAxisWeight;
        const orders = [
            optional.slice().sort((a, b) => score(b) - score(a) || a.uuid.localeCompare(b.uuid)),
            optional.slice().sort((a, b) => this.skill(b, axis) - this.skill(a, axis) || a.uuid.localeCompare(b.uuid)),
            optional.slice().sort((a, b) => this.skill(a, axis) - this.skill(b, axis) || a.uuid.localeCompare(b.uuid))
        ];
        const sets: ConflictPlannerCharacter[][] = defending ? [[]] : [];
        for(const order of orders) {
            for(let size = 1; size <= order.length; size++) {
                sets.push([...forced, ...order.slice(0, size)]);
            }
        }
        if(forced.length > 0) {
            sets.push(forced.slice());
        }
        const unique = new Map<string, ConflictPlannerCharacter[]>();
        for(const set of sets) {
            const ordered = set.slice().sort((a, b) => a.uuid.localeCompare(b.uuid));
            unique.set(ordered.map((card) => card.uuid).join(','), ordered);
        }
        return [...unique.values()]
            .sort((left, right) => left.length - right.length ||
                right.reduce((sum, card) => sum + this.skill(card, axis), 0) -
                left.reduce((sum, card) => sum + this.skill(card, axis), 0))
            .slice(0, Math.max(1, this.profile.maxAttackSets));
    }

    private availableCharacters(state: SearchState, input: ConflictPhasePlannerInput,
        side: 'self' | 'opponent', axis: ConflictAxis): ConflictPlannerCharacter[] {
        const cards = side === 'self' ? input.selfCharacters : input.opponentCharacters;
        const ready = side === 'self' ? state.selfReady : state.opponentReady;
        return cards.filter((card) => ready.has(card.uuid) &&
            (axis === 'military' ? card.legalMilitary !== false : card.legalPolitical !== false));
    }

    private legalTargets(targets: ConflictPlannerTarget[], broken: number): ConflictPlannerTarget[] {
        const stronghold = targets.filter((target) => target.stronghold);
        if(broken >= 3 && stronghold.length > 0) {
            return stronghold;
        }
        return targets.filter((target) => !target.stronghold)
            .sort((a, b) => (a.priority || 0) - (b.priority || 0) || a.strength - b.strength);
    }

    private immediateValue(actor: 'self' | 'opponent', choice: AttackChoice,
        defenders: ConflictPlannerCharacter[], won: boolean, broke: boolean): number {
        let value = choice.ring.fate * this.profile.ringFateValue;
        if(won) {
            value += this.profile.conflictWinValue * this.profile.aggression;
            value += this.ringValue(choice.ring, actor) * this.profile.ringEffectValue;
            if(defenders.length === 0) {
                value += this.profile.unopposedValue;
            }
        } else {
            value -= this.profile.claimedRingValue * this.ringValue(choice.ring,
                actor === 'self' ? 'opponent' : 'self');
        }
        if(broke) {
            value += choice.target.stronghold
                ? this.profile.strongholdBreakValue
                : this.profile.provinceBreakValue * this.profile.aggression;
        }
        return value;
    }

    private terminalValue(state: SearchState, input: ConflictPhasePlannerInput): number {
        const readyValue = (side: 'self' | 'opponent') => {
            const opportunities = side === 'self' ? state.selfOpportunities : state.opponentOpportunities;
            const cards = this.availableCharacters(state, input, side, 'military')
                .reduce((sum, card) => sum + this.skill(card, 'military') * Math.min(1, opportunities.military), 0) +
                this.availableCharacters(state, input, side, 'political')
                    .reduce((sum, card) => sum + this.skill(card, 'political') * Math.min(1, opportunities.political), 0);
            return cards;
        };
        return (readyValue('self') - readyValue('opponent')) * this.profile.readySkillValue;
    }

    private ringValue(ring: ConflictPlannerRing, actor: 'self' | 'opponent'): number {
        return Math.max(0, Number(actor === 'self' ? ring.selfValue : ring.opponentValue) || 0);
    }

    private handThreat(input: ConflictPhasePlannerInput, side: 'self' | 'opponent', axis: ConflictAxis): number {
        const threat = side === 'self' ? input.selfHandThreat : input.opponentHandThreat;
        const opportunities = side === 'self' ? input.selfOpportunities : input.opponentOpportunities;
        // A hand is one shared budget, not a fresh boost in every branch of
        // the rollout. Amortize it across that side's remaining declarations.
        return Math.max(0, Number(threat?.[axis]) || 0) /
            Math.max(1, Number(opportunities.total) || 0);
    }

    private skill(card: ConflictPlannerCharacter, axis: ConflictAxis): number {
        return Math.max(0, Number(card[axis]) || 0);
    }

    private spendOpportunity(opportunities: ConflictPlannerOpportunities, axis: ConflictAxis): void {
        opportunities.total = Math.max(0, opportunities.total - 1);
        opportunities[axis] = Math.max(0, opportunities[axis] - 1);
    }

    private advanceActor(state: SearchState): SearchState {
        const current = state.actor === 'self' ? state.selfOpportunities : state.opponentOpportunities;
        if(current.total > 0) {
            return state;
        }
        const other = state.actor === 'self' ? state.opponentOpportunities : state.selfOpportunities;
        return other.total > 0 ? { ...state, actor: state.actor === 'self' ? 'opponent' : 'self' } : state;
    }

    private copyOpportunities(value: ConflictPlannerOpportunities): ConflictPlannerOpportunities {
        return {
            total: Math.max(0, Math.floor(Number(value.total) || 0)),
            military: Math.max(0, Math.floor(Number(value.military) || 0)),
            political: Math.max(0, Math.floor(Number(value.political) || 0))
        };
    }

    private cloneState(state: SearchState): SearchState {
        return {
            selfReady: new Set(state.selfReady),
            opponentReady: new Set(state.opponentReady),
            selfOpportunities: this.copyOpportunities(state.selfOpportunities),
            opponentOpportunities: this.copyOpportunities(state.opponentOpportunities),
            rings: state.rings.map((ring) => ({ ...ring })),
            selfTargets: state.selfTargets.map((target) => ({ ...target })),
            opponentTargets: state.opponentTargets.map((target) => ({ ...target })),
            selfBroken: state.selfBroken,
            opponentBroken: state.opponentBroken,
            actor: state.actor,
            depth: state.depth
        };
    }

    private stateKey(state: SearchState): string {
        const opportunities = (value: ConflictPlannerOpportunities) =>
            `${value.total}/${value.military}/${value.political}`;
        return [
            state.actor,
            state.depth,
            [...state.selfReady].sort().join(','),
            [...state.opponentReady].sort().join(','),
            opportunities(state.selfOpportunities),
            opportunities(state.opponentOpportunities),
            state.rings.map((ring) => ring.element).sort().join(','),
            state.selfTargets.map((target) => target.location).sort().join(','),
            state.opponentTargets.map((target) => target.location).sort().join(','),
            state.selfBroken,
            state.opponentBroken
        ].join('|');
    }

    private passPlan(score: number, reason: string): ConflictPhasePlan {
        return { action: 'pass', attackerUuids: [], score, sequence: [], reason };
    }
}

export default ConflictPhasePlanner;
