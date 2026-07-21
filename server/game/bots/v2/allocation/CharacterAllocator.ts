import type { PlanConstraint, ResourceReservation } from '../model/Intent';
import type { CharacterProjection, PlanningState } from '../model/PlanningState';
import type { ConflictType } from '../model/References';
import { immutable, stableSerialize } from '../model/Stable';

export type CharacterRole =
    | 'current-attack' | 'later-military' | 'later-political' | 'defense'
    | 'stronghold-reserve' | 'movement-source' | 'ready-source' | 'tower'
    | 'sacrifice' | 'unassigned';

export interface CharacterAssignment {
    readonly characterId: string;
    readonly primary: CharacterRole;
    readonly secondary: readonly CharacterRole[];
    readonly virtualSkill: number;
    readonly reason: string;
}

export interface CharacterAllocation {
    readonly assignments: readonly CharacterAssignment[];
    readonly score: number;
    readonly currentSkill: number;
    readonly laterMilitarySkill: number;
    readonly laterPoliticalSkill: number;
    readonly defenseSkill: number;
    readonly strongholdReserveCount: number;
    readonly exhaustive: boolean;
    readonly explored: number;
    readonly constraints: readonly PlanConstraint[];
    readonly reservations: readonly ResourceReservation[];
}

export interface AllocationProfile {
    readonly aggression?: number;
    readonly strongholdReserveCount?: number;
    readonly exhaustiveCharacterLimit?: number;
    readonly largeBoardBeamWidth?: number;
    readonly movementSourceIds?: readonly string[];
    readonly readySourceIds?: readonly string[];
    readonly towerIds?: readonly string[];
    readonly sacrificeIds?: readonly string[];
    readonly cardCountPayoffIds?: readonly string[];
    readonly minimumCardsForPayoff?: number;
}

interface PartialAllocation {
    readonly assignments: readonly CharacterAssignment[];
    readonly score: number;
}

const ALL_ROLES: readonly CharacterRole[] = [
    'current-attack', 'later-military', 'later-political', 'defense', 'stronghold-reserve',
    'movement-source', 'ready-source', 'tower', 'sacrifice', 'unassigned'
];

function skill(character: CharacterProjection, type: ConflictType): number {
    return type === 'political' ? character.political : character.military;
}

function includes(profileIds: readonly string[] | undefined, character: CharacterProjection): boolean {
    return !!character.cardId && !!profileIds?.includes(character.cardId);
}

function roleOptions(character: CharacterProjection, state: PlanningState, profile: AllocationProfile): CharacterRole[] {
    const result: CharacterRole[] = ['unassigned'];
    const ownOpportunities = state.opportunities.remainingByPlayer[state.perspectivePlayerId] || { military: 0, political: 0 };
    if(character.ready && state.conflict?.attackerId === state.perspectivePlayerId &&
        (state.conflict.type === 'political' ? character.canAttackPolitical : character.canAttackMilitary) &&
        character.attackRestrictions.length === 0) result.push('current-attack');
    if(character.ready && ownOpportunities.military > 0 && character.canAttackMilitary && character.attackRestrictions.length === 0) result.push('later-military');
    if(character.ready && ownOpportunities.political > 0 && character.canAttackPolitical && character.attackRestrictions.length === 0) result.push('later-political');
    if(character.ready) result.push('defense', 'stronghold-reserve');
    if(includes(profile.movementSourceIds, character) || character.traits.some((trait) => /cavalry/i.test(trait))) result.push('movement-source');
    if(includes(profile.readySourceIds, character) || (!character.ready && character.canReady)) result.push('ready-source');
    if(includes(profile.towerIds, character) || includes(profile.cardCountPayoffIds, character) || character.noBowAfterConflict || character.fate >= 2 || character.attachments.length >= 2) result.push('tower');
    if(includes(profile.sacrificeIds, character) || (character.fate === 0 && character.military + character.political <= 2)) result.push('sacrifice');
    return [...new Set(result)].sort((left, right) => ALL_ROLES.indexOf(left) - ALL_ROLES.indexOf(right));
}

function secondaryRoles(character: CharacterProjection, primary: CharacterRole, state: PlanningState,
    profile: AllocationProfile): CharacterRole[] {
    if(!(character.noBowAfterConflict || includes(profile.readySourceIds, character))) return [];
    const roles: CharacterRole[] = [];
    const opportunities = state.opportunities.remainingByPlayer[state.perspectivePlayerId];
    if(primary === 'current-attack' && opportunities?.military && state.conflict?.type !== 'military' && character.canAttackMilitary) roles.push('later-military');
    if(primary === 'current-attack' && opportunities?.political && state.conflict?.type !== 'political' && character.canAttackPolitical) roles.push('later-political');
    if(primary === 'current-attack') roles.push('defense');
    return roles;
}

function assignmentValue(character: CharacterProjection, role: CharacterRole, state: PlanningState,
    profile: AllocationProfile): number {
    const aggression = profile.aggression ?? 0.5;
    const currentType = state.conflict?.type || 'military';
    if(role === 'current-attack') return skill(character, currentType) * (1 + aggression) + (character.covert ? 2 : 0);
    if(role === 'later-military') return character.military * (0.8 + aggression * 0.5);
    if(role === 'later-political') return character.political * (0.8 + aggression * 0.5);
    if(role === 'defense') return Math.max(character.military, character.political) * (1.5 - aggression * 0.5);
    if(role === 'stronghold-reserve') return Math.max(character.military, character.political) * (2 - aggression);
    if(role === 'movement-source') return Math.max(character.military, character.political) * 0.7 + 2;
    if(role === 'ready-source') return Math.max(character.military, character.political) * 0.5 + 2;
    if(role === 'tower') {
        const handSize = state.hands.find((hand) => hand.playerId === state.perspectivePlayerId)?.size || 0;
        const payoff = includes(profile.cardCountPayoffIds, character) && handSize >= (profile.minimumCardsForPayoff || 3) ? 4 : 0;
        return (character.military + character.political) * 0.5 + character.fate + character.attachments.length * 2 + payoff;
    }
    if(role === 'sacrifice') return character.fate === 0 ? 1.5 : -character.fate;
    return 0;
}

function summarize(assignments: readonly CharacterAssignment[], state: PlanningState, profile: AllocationProfile,
    exhaustive: boolean, explored: number): CharacterAllocation {
    const byId = new Map(state.characters.map((character) => [character.instanceId, character]));
    const roleSkill = (role: CharacterRole, type: ConflictType) => assignments
        .filter((assignment) => assignment.primary === role || assignment.secondary.includes(role))
        .reduce((sum, assignment) => sum + skill(byId.get(assignment.characterId)!, type) + assignment.virtualSkill, 0);
    const currentType = state.conflict?.type || 'military';
    const currentSkill = roleSkill('current-attack', currentType);
    const laterMilitarySkill = roleSkill('later-military', 'military');
    const laterPoliticalSkill = roleSkill('later-political', 'political');
    const defenseSkill = roleSkill('defense', state.conflict?.type || 'military');
    const strongholdReserveCount = assignments.filter((assignment) => assignment.primary === 'stronghold-reserve').length;
    const ownStrongholdThreat = state.conflict?.defenderId === state.perspectivePlayerId && state.conflict.provinceLocation === 'stronghold province';
    const lastConflict = state.opportunities.totalRemaining <= 1;
    const opponentCovert = state.characters.some((character) =>
        character.controllerId !== state.perspectivePlayerId && character.ready && character.covert);
    const reserveMinimum = lastConflict ? 0 : Math.max(profile.strongholdReserveCount || 0, ownStrongholdThreat ? 1 : 0) + (opponentCovert ? 1 : 0);
    const currentTarget = state.conflict
        ? Math.max(state.conflict.defenderSkill + 1, state.conflict.breakThreshold || state.conflict.provinceStrength)
        : 0;
    const baseScore = assignments.reduce((sum, assignment) => {
        const character = byId.get(assignment.characterId)!;
        return sum + assignmentValue(character, assignment.primary, state, profile) + assignment.secondary.length;
    }, 0);
    const thresholdScore = Math.min(currentSkill, currentTarget) - Math.max(0, currentSkill - currentTarget) * 0.3 +
        Math.min(laterMilitarySkill, 5) * 0.5 + Math.min(laterPoliticalSkill, 5) * 0.5 + defenseSkill * 0.4;
    const opportunities = state.opportunities.remainingByPlayer[state.perspectivePlayerId] || { military: 0, political: 0 };
    const currentMilitary = state.conflict?.attackerId === state.perspectivePlayerId && state.conflict.type === 'military';
    const currentPolitical = state.conflict?.attackerId === state.perspectivePlayerId && state.conflict.type === 'political';
    const uncoveredLaterPenalty =
        (opportunities.military > (currentMilitary ? 1 : 0) && laterMilitarySkill <= 0 ? 8 : 0) +
        (opportunities.political > (currentPolitical ? 1 : 0) && laterPoliticalSkill <= 0 ? 8 : 0);
    const reservePenalty = Math.max(0, reserveMinimum - strongholdReserveCount) * 1000;
    const constraints: PlanConstraint[] = reserveMinimum > 0 ? [{
        id: 'allocation:stronghold-reserve', kind: 'hard',
        predicate: { kind: 'ready-defenders', operator: 'gte', value: reserveMinimum },
        reason: 'retain minimum defenders for exposed or future stronghold attack'
    }] : [{
        id: 'allocation:future-conflict-skill', kind: 'soft',
        predicate: { kind: 'later-conflict-ready-skill', operator: 'gte', value: Math.min(3, laterMilitarySkill + laterPoliticalSkill) },
        reason: 'retain useful skill for remaining conflict opportunities'
    }];
    const reservations: ResourceReservation[] = assignments.filter((assignment) => assignment.primary === 'stronghold-reserve').map((assignment) => {
        const character = byId.get(assignment.characterId)!;
        return {
            id: `allocation:defender:${character.instanceId}`, resource: 'defender' as const, amount: 1,
            target: { kind: 'character' as const, instanceId: character.instanceId, cardId: character.cardId, controllerId: character.controllerId },
            hard: reserveMinimum > 0
        };
    });
    return immutable({
        assignments,
        score: baseScore + thresholdScore - reservePenalty - uncoveredLaterPenalty,
        currentSkill, laterMilitarySkill, laterPoliticalSkill, defenseSkill,
        strongholdReserveCount, exhaustive, explored, constraints, reservations
    }) as CharacterAllocation;
}

export default class CharacterAllocator {
    private readonly cache = new Map<string, CharacterAllocation>();

    allocate(state: PlanningState, profile: AllocationProfile = {}): CharacterAllocation {
        const cacheKey = stableSerialize({ state: state.materialStateSignature, profile });
        const cached = this.cache.get(cacheKey);
        if(cached) return cached;
        const characters = state.characters.filter((character) => character.controllerId === state.perspectivePlayerId)
            .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
        const exhaustive = characters.length <= (profile.exhaustiveCharacterLimit ?? 3);
        const beamWidth = exhaustive ? Number.MAX_SAFE_INTEGER : (profile.largeBoardBeamWidth ?? 32);
        let explored = 0;
        let frontier: PartialAllocation[] = [{ assignments: [], score: 0 }];
        for(const character of characters) {
            const next: PartialAllocation[] = [];
            for(const partial of frontier) {
                for(const role of roleOptions(character, state, profile)) {
                    explored++;
                    const secondary = secondaryRoles(character, role, state, profile);
                    const virtualSkill = role === 'movement-source' ? Math.max(character.military, character.political) * 0.5 : 0;
                    next.push({
                        assignments: [...partial.assignments, {
                            characterId: character.instanceId, primary: role, secondary, virtualSkill,
                            reason: `${role}:skill=${Math.max(character.military, character.political)}`
                        }],
                        score: partial.score + assignmentValue(character, role, state, profile) + secondary.length
                    });
                }
            }
            next.sort((left, right) => right.score - left.score || stableSerialize(left.assignments).localeCompare(stableSerialize(right.assignments)));
            frontier = next.slice(0, beamWidth);
        }
        const allocations = frontier.map((partial) => summarize(partial.assignments, state, profile, exhaustive, explored));
        allocations.sort((left, right) => right.score - left.score || stableSerialize(left.assignments).localeCompare(stableSerialize(right.assignments)));
        const result = allocations[0] || summarize([], state, profile, exhaustive, explored);
        this.cache.set(cacheKey, result);
        if(this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
        return result;
    }
}
