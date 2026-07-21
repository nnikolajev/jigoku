import type { BotActionCandidate, CandidateAnnotation } from '../model/Candidate';
import type { ResourceReservation } from '../model/Intent';
import type { PlanningState } from '../model/PlanningState';
import type { UtilityVector } from '../model/Utility';
import { immutable, stableSerialize } from '../model/Stable';

export type ResourceArchetype = 'rush' | 'tower' | 'holding' | 'dishonor' | 'duel' | 'monk' | 'shugenja' | 'movement' | 'generic';

export interface ResourceCardProfile {
    readonly printedCost?: number;
    readonly type?: 'character' | 'holding' | 'attachment' | 'event';
    readonly noBow?: boolean;
    readonly readyValue?: number;
    readonly conflictCharacter?: boolean;
    readonly alternativeFateCost?: number;
    readonly value?: number;
    readonly tags?: readonly string[];
}

export interface ResourcePlanningProfile {
    readonly archetype?: ResourceArchetype;
    readonly gameHorizon?: number;
    readonly expectedRingFateWeight?: number;
    readonly honorFloor?: number;
    readonly maximumPackages?: number;
    readonly cards?: Readonly<Record<string, ResourceCardProfile>>;
    readonly candidateValues?: Readonly<Record<string, number>>;
}

export interface ResourcePackage {
    readonly id: string;
    readonly kind: 'dynasty' | 'conflict';
    readonly candidateIds: readonly string[];
    readonly fateCost: number;
    readonly honorCost: number;
    readonly cardCost: number;
    readonly expectedValue: number;
    readonly expectedParticipations: number;
    readonly reducerIds: readonly string[];
    readonly rationale: readonly string[];
}

export interface JointResourcePlan {
    readonly dynastyPackages: readonly ResourcePackage[];
    readonly conflictPackages: readonly ResourcePackage[];
    readonly selectedDynasty?: ResourcePackage;
    readonly selectedConflict?: ResourcePackage;
    readonly reservations: readonly ResourceReservation[];
    readonly preferredCandidateIds: readonly string[];
    readonly releasedReservationIds: readonly string[];
    readonly marginalDynastyValue: number;
    readonly marginalConflictValue: number;
}

export const ARCHETYPE_RESOURCE_PROFILES: Readonly<Record<ResourceArchetype, Readonly<{
    dynastyWeight: number;
    conflictWeight: number;
    fateLongevityWeight: number;
    firstPassFateValue: number;
}>>> = Object.freeze({
    generic: { dynastyWeight: 1, conflictWeight: 1, fateLongevityWeight: 1, firstPassFateValue: 1 },
    rush: { dynastyWeight: 1.2, conflictWeight: 1.3, fateLongevityWeight: 0.6, firstPassFateValue: 0.6 },
    tower: { dynastyWeight: 1.1, conflictWeight: 1.4, fateLongevityWeight: 1.5, firstPassFateValue: 1.1 },
    holding: { dynastyWeight: 1.4, conflictWeight: 0.8, fateLongevityWeight: 0.8, firstPassFateValue: 1.2 },
    dishonor: { dynastyWeight: 1, conflictWeight: 1.3, fateLongevityWeight: 1, firstPassFateValue: 1 },
    duel: { dynastyWeight: 1, conflictWeight: 1.35, fateLongevityWeight: 1.25, firstPassFateValue: 1 },
    monk: { dynastyWeight: 1.05, conflictWeight: 1.35, fateLongevityWeight: 1.2, firstPassFateValue: 0.9 },
    shugenja: { dynastyWeight: 0.95, conflictWeight: 1.5, fateLongevityWeight: 1.25, firstPassFateValue: 1.1 },
    movement: { dynastyWeight: 1.2, conflictWeight: 1.25, fateLongevityWeight: 0.9, firstPassFateValue: 0.8 }
});

function numericCost(candidate: BotActionCandidate, key: 'fate' | 'honor' | 'cards'): number {
    return Math.max(0, Number(candidate.costs[key]) || 0);
}

function cardProfile(candidate: BotActionCandidate, profile: ResourcePlanningProfile): ResourceCardProfile {
    return profile.cards?.[candidate.source?.cardId || ''] || {};
}

function packageId(kind: ResourcePackage['kind'], candidateIds: readonly string[]): string {
    return `package:${kind}:${candidateIds.slice().sort().join('|')}`;
}

function combinations<T>(groups: readonly (readonly T[])[], maximum: number): T[][] {
    let result: T[][] = [[]];
    for(const group of groups) {
        const next: T[][] = [];
        for(const partial of result) {
            next.push(partial);
            for(const item of group) next.push([...partial, item]);
        }
        result = next.slice(0, maximum);
    }
    return result;
}

export default class ResourcePackagePlanner {
    expectedFutureParticipations(input: {
        printedCost: number;
        fate: number;
        readyValue?: number;
        noBow?: boolean;
        boardUrgency?: number;
        currentRound?: number;
        gameHorizon?: number;
    }): number {
        const horizon = Math.max(1, input.gameHorizon || 3);
        const rounds = Math.min(horizon, 1 + Math.max(0, input.fate));
        const cadence = input.noBow ? 1.7 : 1;
        const ready = 1 + Math.max(0, input.readyValue || 0) * 0.25;
        const urgency = 1 + Math.max(0, input.boardUrgency || 0) * 0.2;
        const costReliability = Math.max(0.5, Math.min(1.25, (input.printedCost + 1) / 4));
        return Number((rounds * cadence * ready * urgency * costReliability).toFixed(3));
    }

    plan(state: PlanningState, candidates: readonly BotActionCandidate[], profile: ResourcePlanningProfile = {}): JointResourcePlan {
        const archetype = ARCHETYPE_RESOURCE_PROFILES[profile.archetype || 'generic'];
        const maximum = profile.maximumPackages || 256;
        const dynasty = candidates.filter((candidate) => candidate.kind === 'dynasty-purchase');
        const bySource = new Map<string, BotActionCandidate[]>();
        for(const candidate of dynasty) {
            const key = candidate.source?.instanceId || candidate.id;
            const group = bySource.get(key) || [];
            group.push(candidate);
            bySource.set(key, group);
        }
        const dynastyPackages = combinations([...bySource.values()].map((group) => group.sort((left, right) => left.id.localeCompare(right.id))), maximum)
            .filter((items) => items.length > 0)
            .map((items) => this.dynastyPackage(state, items, profile, archetype))
            .filter((item) => item.fateCost <= state.players[state.perspectivePlayerId].fate)
            .sort((left, right) => right.expectedValue - left.expectedValue || left.id.localeCompare(right.id))
            .slice(0, maximum);

        const conflictCandidates = candidates.filter((candidate) =>
            ['conflict-card', 'in-play-ability', 'reaction', 'interrupt'].includes(candidate.kind) && candidate.kind !== 'v1-fallback');
        const expectedRingFate = state.rings.filter((ring) => ring.selectable && !ring.claimedBy)
            .reduce((sum, ring) => sum + ring.fate, 0) * (profile.expectedRingFateWeight ?? 0.25);
        const conflictGroups = conflictCandidates.map((candidate) => [candidate] as const);
        const conflictPackages = combinations(conflictGroups, maximum)
            .filter((items) => items.length > 0)
            .map((items) => this.conflictPackage(items, profile, archetype))
            .filter((item) => item.fateCost <= state.players[state.perspectivePlayerId].fate + expectedRingFate &&
                state.players[state.perspectivePlayerId].honor - item.honorCost > (profile.honorFloor || 0) &&
                item.cardCost <= (state.hands.find((hand) => hand.playerId === state.perspectivePlayerId)?.size || 0))
            .sort((left, right) => right.expectedValue - left.expectedValue || left.id.localeCompare(right.id))
            .slice(0, maximum);

        const selectedDynasty = dynastyPackages[0];
        const selectedConflict = conflictPackages[0];
        const firstPassValue = archetype.firstPassFateValue;
        const marginalDynastyValue = selectedDynasty ? selectedDynasty.expectedValue - selectedDynasty.fateCost * firstPassValue : 0;
        const marginalConflictValue = selectedConflict ? selectedConflict.expectedValue - selectedConflict.fateCost * firstPassValue : 0;
        const conflictWorthReserving = !!selectedConflict && (marginalConflictValue >= marginalDynastyValue || state.phase !== 'dynasty');
        const terminalDefense = state.conflict?.defenderId === state.perspectivePlayerId && state.conflict.provinceLocation === 'stronghold province';
        const reservations: ResourceReservation[] = conflictWorthReserving ? [
            ...(selectedConflict!.fateCost > 0 ? [{
                id: `resource:fate:${selectedConflict!.id}`, resource: 'fate' as const,
                amount: selectedConflict!.fateCost, hard: terminalDefense,
                releaseWhen: { kind: 'package-legal', operator: 'eq' as const, value: false }
            }] : []),
            ...(selectedConflict!.cardCost > 0 ? [{
                id: `resource:cards:${selectedConflict!.id}`, resource: 'card' as const,
                amount: selectedConflict!.cardCost, hard: terminalDefense,
                releaseWhen: { kind: 'package-legal', operator: 'eq' as const, value: false }
            }] : []),
            ...selectedConflict!.reducerIds.map((id) => ({
                id: `resource:reducer:${id}`, resource: 'reducer' as const, amount: 1,
                target: { kind: 'card' as const, instanceId: id, cardId: id, controllerId: state.perspectivePlayerId },
                hard: false,
                releaseWhen: { kind: 'package-legal', operator: 'eq' as const, value: false }
            }))
        ] : [];
        const selected = marginalDynastyValue > marginalConflictValue ? selectedDynasty : selectedConflict;
        return immutable({
            dynastyPackages, conflictPackages, selectedDynasty, selectedConflict, reservations,
            preferredCandidateIds: selected?.candidateIds || [],
            releasedReservationIds: conflictWorthReserving ? [] : selectedConflict ? [`package-released:${selectedConflict.id}`] : [],
            marginalDynastyValue, marginalConflictValue
        }) as JointResourcePlan;
    }

    annotate(candidates: readonly BotActionCandidate[], plan: JointResourcePlan): readonly BotActionCandidate[] {
        const preferred = new Set(plan.preferredCandidateIds);
        return immutable(candidates.map((candidate) => {
            if(!preferred.has(candidate.id)) return candidate;
            const annotation: CandidateAnnotation = {
                proposer: 'resource-package-planner', note: 'member-of-selected-joint-package',
                scoreDelta: { comboProgress: 2, flexibility: 1 } as Partial<UtilityVector>
            };
            return { ...candidate, annotations: [...(candidate.annotations || []), annotation] };
        })) as readonly BotActionCandidate[];
    }

    private dynastyPackage(state: PlanningState, items: readonly BotActionCandidate[], profile: ResourcePlanningProfile,
        archetype: typeof ARCHETYPE_RESOURCE_PROFILES[ResourceArchetype]): ResourcePackage {
        let participations = 0;
        let value = 0;
        const rationale: string[] = [];
        for(const candidate of items) {
            const card = cardProfile(candidate, profile);
            const fate = candidate.costs.additionalFate || 0;
            if(card.type === 'holding') {
                value += (card.value || 2) * archetype.dynastyWeight;
                rationale.push(`holding:${candidate.source?.cardId || candidate.id}`);
            } else {
                const expected = this.expectedFutureParticipations({
                    printedCost: card.printedCost ?? Math.max(0, numericCost(candidate, 'fate') - fate),
                    fate, readyValue: card.readyValue, noBow: card.noBow,
                    boardUrgency: state.characters.filter((character) => character.controllerId === state.perspectivePlayerId).length === 0 ? 2 : 0,
                    currentRound: Number(state.scopes.roundId) || 1, gameHorizon: profile.gameHorizon
                });
                participations += expected;
                value += expected * archetype.fateLongevityWeight + (card.value || 0);
                rationale.push(`character:${candidate.source?.cardId || candidate.id}:participations=${expected}`);
            }
        }
        const fateCost = items.reduce((sum, candidate) => sum + numericCost(candidate, 'fate'), 0);
        return {
            id: packageId('dynasty', items.map((candidate) => candidate.id)), kind: 'dynasty',
            candidateIds: items.map((candidate) => candidate.id).sort(), fateCost,
            honorCost: items.reduce((sum, candidate) => sum + numericCost(candidate, 'honor'), 0),
            cardCost: items.reduce((sum, candidate) => sum + numericCost(candidate, 'cards'), 0),
            expectedValue: Number((value * archetype.dynastyWeight).toFixed(3)),
            expectedParticipations: participations, reducerIds: [], rationale
        };
    }

    private conflictPackage(items: readonly BotActionCandidate[], profile: ResourcePlanningProfile,
        archetype: typeof ARCHETYPE_RESOURCE_PROFILES[ResourceArchetype]): ResourcePackage {
        const reducers = items.filter((candidate) => candidate.tags.includes('reducer'));
        const reduction = reducers.reduce((sum, candidate) => sum + candidate.effects
            .filter((effect) => effect.kind === 'reduction').reduce((inner, effect: any) => inner + effect.amount, 0), 0);
        const rawFate = items.reduce((sum, candidate) => {
            const alternative = cardProfile(candidate, profile).alternativeFateCost;
            const ordinary = numericCost(candidate, 'fate');
            return sum + (alternative === undefined ? ordinary : Math.min(ordinary, Math.max(0, alternative)));
        }, 0);
        const effects = items.reduce((sum, candidate) => sum + candidate.effects.length, 0);
        const value = items.reduce((sum, candidate) => {
            const card = cardProfile(candidate, profile);
            const semantic = candidate.effects.reduce((effectValue, effect) => effectValue +
                (effect.kind === 'skill' ? Math.max(effect.military || 0, effect.political || 0) :
                    ['remove', 'bow', 'cancel', 'prevention'].includes(effect.kind) ? 4 :
                        effect.kind === 'ring' ? 3 : effect.kind === 'ready' || effect.kind === 'move' ? 2 : 1), 0);
            return sum + (profile.candidateValues?.[candidate.source?.cardId || ''] ?? card.value ?? semantic);
        }, 0);
        return {
            id: packageId('conflict', items.map((candidate) => candidate.id)), kind: 'conflict',
            candidateIds: items.map((candidate) => candidate.id).sort(),
            fateCost: Math.max(0, rawFate - reduction),
            honorCost: items.reduce((sum, candidate) => sum + numericCost(candidate, 'honor'), 0),
            cardCost: items.reduce((sum, candidate) => sum + numericCost(candidate, 'cards'), 0),
            expectedValue: Number(((value + effects * 0.25) * archetype.conflictWeight).toFixed(3)),
            expectedParticipations: items.filter((candidate) => cardProfile(candidate, profile).conflictCharacter).length,
            reducerIds: reducers.map((candidate) => candidate.source?.instanceId || candidate.id).sort(),
            rationale: [`effects=${effects}`, `raw-fate=${rawFate}`, `reduction=${reduction}`]
        };
    }
}
