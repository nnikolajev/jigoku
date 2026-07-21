import type { TargetRef } from './References';

export const OBJECTIVE_PRIORITY = [
    'WIN_GAME',
    'PREVENT_GAME_LOSS',
    'WIN_GAME_STRONGHOLD',
    'SURVIVE_STRONGHOLD',
    'PRESS_HONOR_WIN',
    'AVOID_DISHONOR_LOSS',
    'AVOID_DECK_LOSS',
    'BREAK_PROVINCE',
    'PREVENT_BREAK',
    'WIN_CONFLICT',
    'CLAIM_RING',
    'GAIN_RING_FATE',
    'PRESERVE_TOWER',
    'BUILD_BOARD',
    'EXECUTE_COMBO',
    'SCOUT_PROVINCE',
    'PASS_FOR_DYNASTY_FATE'
] as const;

export type BotObjective = typeof OBJECTIVE_PRIORITY[number];
export type IntentScope = 'game' | 'round' | 'phase' | 'conflict' | 'macro';

export interface OutcomePredicate {
    readonly kind: string;
    readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'absent';
    readonly value?: string | number | boolean;
    readonly target?: TargetRef;
}

export interface PlanConstraint {
    readonly id: string;
    readonly kind: 'hard' | 'soft';
    readonly predicate: OutcomePredicate;
    readonly reason: string;
}

export type ReservedResource = 'fate' | 'card' | 'defender' | 'reducer' | 'conflict-opportunity' | 'combo-piece';

export interface ResourceReservation {
    readonly id: string;
    readonly resource: ReservedResource;
    readonly amount: number;
    readonly target?: TargetRef;
    readonly hard: boolean;
    readonly releaseWhen?: OutcomePredicate;
}

export interface PlannedLine {
    readonly id: string;
    readonly candidateIds: readonly string[];
    readonly expectedUtility: number;
    readonly confidence: number;
}

export interface IntentExpiry {
    readonly roundId?: string;
    readonly phaseId?: string;
    readonly conflictId?: string;
    readonly materialSignature?: string;
}

export interface BotIntent {
    readonly id: string;
    readonly scope: IntentScope;
    readonly objective: BotObjective;
    readonly stateSignature: string;
    readonly success: readonly OutcomePredicate[];
    readonly failure: readonly OutcomePredicate[];
    readonly constraints: readonly PlanConstraint[];
    readonly reservations: readonly ResourceReservation[];
    readonly preferredLines: readonly PlannedLine[];
    readonly confidence: number;
    readonly expiresAt: IntentExpiry;
}

export type IntentInvalidationReason =
    | 'success'
    | 'failure'
    | 'round-expired'
    | 'phase-expired'
    | 'conflict-expired'
    | 'material-state-change'
    | 'target-stale'
    | 'command-rejected'
    | 'macro-mismatch'
    | 'opponent-disruption';

export function objectiveRank(objective: BotObjective): number {
    const index = OBJECTIVE_PRIORITY.indexOf(objective);
    return index < 0 ? OBJECTIVE_PRIORITY.length : index;
}
