import type { MacroProgress } from './Macro';
import type { GameScopeRef } from './References';
import { immutable } from './Stable';

export interface UsageLedgerEntry {
    readonly key: string;
    readonly scope: 'conflict' | 'phase' | 'round' | 'game';
    readonly scopeId: string;
    readonly count: number;
    readonly targetIds: readonly string[];
}

export interface DelayedEffectEntry {
    readonly id: string;
    readonly resolvesAt: string;
    readonly sourceId?: string;
    readonly targetIds: readonly string[];
}

export interface PlanningLedgers {
    readonly scopes: GameScopeRef;
    readonly usage: readonly UsageLedgerEntry[];
    readonly effectTargets: Readonly<Record<string, readonly string[]>>;
    readonly delayedEffects: readonly DelayedEffectEntry[];
    readonly reducersConsumed: readonly string[];
    readonly movementTriggers: readonly string[];
    readonly duels: readonly string[];
    readonly macro?: MacroProgress;
}

export function emptyLedgers(scopes: GameScopeRef): PlanningLedgers {
    return immutable({
        scopes,
        usage: [],
        effectTargets: {},
        delayedEffects: [],
        reducersConsumed: [],
        movementTriggers: [],
        duels: []
    }) as PlanningLedgers;
}

export function resetLedgers(previous: PlanningLedgers, nextScopes: GameScopeRef): PlanningLedgers {
    const conflictChanged = previous.scopes.conflictId !== nextScopes.conflictId;
    const phaseChanged = previous.scopes.phaseId !== nextScopes.phaseId;
    const roundChanged = previous.scopes.roundId !== nextScopes.roundId;
    const keepUsage = previous.usage.filter((entry) => {
        if(entry.scope === 'game') return true;
        if(entry.scope === 'round') return !roundChanged;
        if(entry.scope === 'phase') return !roundChanged && !phaseChanged;
        return !roundChanged && !phaseChanged && !conflictChanged;
    });
    return immutable({
        ...previous,
        scopes: nextScopes,
        usage: keepUsage,
        effectTargets: conflictChanged || phaseChanged || roundChanged ? {} : previous.effectTargets,
        delayedEffects: previous.delayedEffects,
        reducersConsumed: roundChanged ? [] : previous.reducersConsumed,
        movementTriggers: conflictChanged ? [] : previous.movementTriggers,
        duels: conflictChanged ? [] : previous.duels,
        macro: phaseChanged || roundChanged ? undefined : previous.macro
    }) as PlanningLedgers;
}

export function recordUsage(ledgers: PlanningLedgers, entry: UsageLedgerEntry): PlanningLedgers {
    const without = ledgers.usage.filter((current) =>
        !(current.key === entry.key && current.scope === entry.scope && current.scopeId === entry.scopeId));
    return immutable({ ...ledgers, usage: [...without, entry] }) as PlanningLedgers;
}
