import type { ActionMacro, MacroProgress } from './model/Macro';
import type {
    BotIntent,
    BotObjective,
    IntentInvalidationReason,
    IntentScope,
    ResourceReservation
} from './model/Intent';
import { objectiveRank } from './model/Intent';
import type { PlanningState } from './model/PlanningState';
import { immutable, stableHash } from './model/Stable';
import MacroExecutor, { type MacroContinuation } from './MacroExecutor';
import CharacterAllocator, { type AllocationProfile } from './allocation/CharacterAllocator.js';

export interface IntentProfile {
    readonly fateReserve?: number;
    readonly conflictCardReserve?: number;
    readonly strongholdDefenderCount?: number;
    readonly comboCardIds?: readonly string[];
    readonly reducerIds?: readonly string[];
    readonly conflictOpportunityReserve?: number;
    readonly allocation?: AllocationProfile;
}

const characterAllocator = new CharacterAllocator();

export interface IntentTransition {
    readonly intent: BotIntent;
    readonly previousIntentId?: string;
    readonly retained: boolean;
    readonly invalidationReason?: IntentInvalidationReason;
    readonly macro?: MacroContinuation;
}

function intentId(objective: BotObjective, state: PlanningState): string {
    return `intent:${objective.toLowerCase()}:${stableHash({
        objective,
        scope: state.scopes,
        perspective: state.perspectivePlayerId,
        conflict: state.conflict?.id
    })}`;
}

function reservations(state: PlanningState, profile: IntentProfile): ResourceReservation[] {
    const result: ResourceReservation[] = [];
    if((profile.fateReserve || 0) > 0) {
        result.push({ id: 'reserve:fate', resource: 'fate', amount: profile.fateReserve || 0, hard: false });
    }
    if((profile.conflictCardReserve || 0) > 0) {
        result.push({ id: 'reserve:cards', resource: 'card', amount: profile.conflictCardReserve || 0, hard: false });
    }
    const ownStronghold = state.provinces.find((province) =>
        province.controllerId === state.perspectivePlayerId && province.stronghold);
    const defenderCount = profile.strongholdDefenderCount || (ownStronghold?.inConflict ? 1 : 0);
    if(defenderCount > 0) {
        const defenders = state.characters
            .filter((character) => character.controllerId === state.perspectivePlayerId && character.ready)
            .sort((left, right) =>
                (right.military + right.political) - (left.military + left.political) ||
                left.instanceId.localeCompare(right.instanceId))
            .slice(0, defenderCount);
        for(const defender of defenders) {
            result.push({
                id: `reserve:defender:${defender.instanceId}`,
                resource: 'defender',
                amount: 1,
                target: { kind: 'character', instanceId: defender.instanceId, cardId: defender.cardId, controllerId: defender.controllerId },
                hard: !!ownStronghold?.inConflict
            });
        }
    }
    for(const cardId of profile.comboCardIds || []) {
        const hand = state.hands.find((projection) => projection.playerId === state.perspectivePlayerId);
        const card = hand?.cards.find((entry) => entry.cardId === cardId);
        if(card) {
            result.push({
                id: `reserve:combo:${cardId}`,
                resource: 'combo-piece', amount: 1,
                target: { kind: 'card', instanceId: card.instanceId || cardId, cardId, controllerId: state.perspectivePlayerId, location: 'hand' },
                hard: false
            });
        }
    }
    for(const reducerId of profile.reducerIds || []) {
        result.push({
            id: `reserve:reducer:${reducerId}`,
            resource: 'reducer', amount: 1,
            target: { kind: 'card', instanceId: reducerId, cardId: reducerId, controllerId: state.perspectivePlayerId },
            hard: false
        });
    }
    if((profile.conflictOpportunityReserve || 0) > 0) {
        result.push({
            id: 'reserve:conflict-opportunity',
            resource: 'conflict-opportunity', amount: profile.conflictOpportunityReserve || 0,
            hard: false
        });
    }
    return result;
}

function objectiveFor(state: PlanningState): { objective: BotObjective; scope: IntentScope } {
    const me = state.players[state.perspectivePlayerId];
    const opponent = Object.values(state.players).find((player) => player.id !== state.perspectivePlayerId);
    const ownStronghold = state.provinces.find((province) => province.controllerId === me.id && province.stronghold);
    const enemyStronghold = opponent && state.provinces.find((province) => province.controllerId === opponent.id && province.stronghold);
    if(state.conflict?.provinceLocation === 'stronghold province' && state.conflict.attackerId === me.id &&
        state.conflict.attackerSkill >= state.conflict.defenderSkill + Math.max(1, state.conflict.breakThreshold)) {
        return { objective: 'WIN_GAME_STRONGHOLD', scope: 'conflict' };
    }
    if(ownStronghold?.inConflict || (state.conflict?.provinceLocation === 'stronghold province' && state.conflict.defenderId === me.id)) {
        return { objective: 'SURVIVE_STRONGHOLD', scope: 'conflict' };
    }
    if(me.honor <= 1) return { objective: 'AVOID_DISHONOR_LOSS', scope: 'round' };
    if(me.conflictDeckSize <= 1) return { objective: 'AVOID_DECK_LOSS', scope: 'round' };
    if(opponent && opponent.honor >= 24) return { objective: 'PREVENT_GAME_LOSS', scope: 'round' };
    if(me.honor >= 24) return { objective: 'PRESS_HONOR_WIN', scope: 'round' };
    if(state.conflict) {
        const defending = state.conflict.defenderId === me.id;
        if(defending && state.conflict.attackerSkill >= state.conflict.defenderSkill + Math.max(1, state.conflict.breakThreshold)) {
            return { objective: 'PREVENT_BREAK', scope: 'conflict' };
        }
        return { objective: 'WIN_CONFLICT', scope: 'conflict' };
    }
    if(state.phase === 'dynasty') return { objective: 'BUILD_BOARD', scope: 'phase' };
    return { objective: 'CLAIM_RING', scope: 'phase' };
}

function createIntent(state: PlanningState, profile: IntentProfile): BotIntent {
    const selected = objectiveFor(state);
    const allocation = characterAllocator.allocate(state, profile.allocation);
    const conflictId = selected.scope === 'conflict' ? state.scopes.conflictId : undefined;
    const conflictSuccess = state.conflict ? [
        { kind: 'conflict-winner', operator: 'eq' as const, value: state.perspectivePlayerId },
        ...(state.conflict.attackerId === state.perspectivePlayerId
            ? [{ kind: 'province-broken', operator: 'eq' as const, value: true }]
            : [{ kind: 'province-break-prevented', operator: 'eq' as const, value: true }]),
        ...(state.conflict.ring ? [{ kind: 'ring-claimed', operator: 'eq' as const, value: state.conflict.ring }] : []),
        { kind: 'ring-fate-collected', operator: 'gte' as const, value: 0 },
        { kind: 'later-conflict-ready-skill', operator: 'gte' as const, value: 0 }
    ] : [];
    return immutable({
        id: intentId(selected.objective, state),
        scope: selected.scope,
        objective: selected.objective,
        stateSignature: state.materialStateSignature,
        success: conflictSuccess.length > 0
            ? conflictSuccess
            : [{ kind: `objective:${selected.objective}`, operator: 'eq', value: true }],
        failure: [{ kind: `objective:${selected.objective}`, operator: 'eq', value: false }],
        constraints: [...(state.conflict ? [{
            id: 'retain-later-conflict-capability', kind: 'soft',
            predicate: { kind: 'later-conflict-ready-skill', operator: 'gte', value: 0 },
            reason: 'do not consume all future attack, defense, and conflict-opportunity resources'
        } as const] : []), ...allocation.constraints],
        reservations: [...reservations(state, profile), ...allocation.reservations],
        preferredLines: [],
        confidence: selected.objective === 'SURVIVE_STRONGHOLD' || selected.objective === 'WIN_GAME_STRONGHOLD' ? 1 : 0.75,
        expiresAt: {
            roundId: state.scopes.roundId,
            phaseId: selected.scope === 'phase' || selected.scope === 'conflict' ? state.scopes.phaseId : undefined,
            conflictId,
            materialSignature: state.materialStateSignature
        }
    }) as BotIntent;
}

export default class IntentManager {
    private current?: BotIntent;
    private macro?: ActionMacro;
    private macroProgress?: MacroProgress;
    private readonly macroExecutor = new MacroExecutor();

    get activeIntent(): BotIntent | undefined {
        return this.current;
    }

    get hasActiveMacro(): boolean {
        return !!this.macro && !!this.macroProgress;
    }

    setMacro(macro: ActionMacro, progress?: MacroProgress): void {
        this.macro = macro;
        this.macroProgress = progress || { macroId: macro.id, completedStepIds: [] };
    }

    completeMacroStep(stepId: string): void {
        if(this.macro && this.macroProgress) {
            this.macroProgress = this.macroExecutor.completeStep(this.macro, this.macroProgress, stepId);
            if(this.macroProgress.completedStepIds.length >= this.macro.steps.length) {
                this.macro = undefined;
                this.macroProgress = undefined;
            }
        }
    }

    invalidate(reason: IntentInvalidationReason): IntentInvalidationReason {
        this.current = undefined;
        if(reason === 'command-rejected' || reason === 'macro-mismatch' || reason === 'phase-expired' || reason === 'round-expired') {
            this.macro = undefined;
            this.macroProgress = undefined;
        }
        return reason;
    }

    update(state: PlanningState, profile: IntentProfile = {}): IntentTransition {
        let macroInvalidationReason: IntentInvalidationReason | undefined;
        if(this.macro && this.macroProgress) {
            const continuation = this.macroExecutor.continue(this.macro, state, this.macroProgress.completedStepIds);
            if(continuation.status === 'continue' && this.current) {
                return immutable({ intent: this.current, previousIntentId: this.current.id, retained: true, macro: continuation }) as IntentTransition;
            }
            if(continuation.status === 'complete') {
                this.macro = undefined;
                this.macroProgress = undefined;
            } else if(continuation.status === 'abort') {
                macroInvalidationReason = 'macro-mismatch';
                this.invalidate('macro-mismatch');
            }
        }
        const previous = this.current;
        let invalidationReason: IntentInvalidationReason | undefined = macroInvalidationReason;
        if(previous) {
            if(previous.expiresAt.roundId && previous.expiresAt.roundId !== state.scopes.roundId) invalidationReason = 'round-expired';
            else if(previous.expiresAt.phaseId && previous.expiresAt.phaseId !== state.scopes.phaseId) invalidationReason = 'phase-expired';
            else if(previous.expiresAt.conflictId && previous.expiresAt.conflictId !== state.scopes.conflictId) invalidationReason = 'conflict-expired';
        }
        const proposed = createIntent(state, profile);
        const higherPriority = previous && objectiveRank(proposed.objective) < objectiveRank(previous.objective);
        const sameObjective = previous?.objective === proposed.objective && previous.scope === proposed.scope;
        if(previous && !invalidationReason && sameObjective && !higherPriority) {
            // Material changes trigger re-evaluation, but the same still-valid
            // semantic objective remains sticky and receives refreshed facts.
            this.current = proposed;
            return immutable({
                intent: proposed,
                previousIntentId: previous.id,
                retained: true,
                invalidationReason: previous.stateSignature === state.materialStateSignature ? undefined : 'material-state-change'
            }) as IntentTransition;
        }
        this.current = proposed;
        return immutable({
            intent: proposed,
            previousIntentId: previous?.id,
            retained: false,
            invalidationReason: invalidationReason || (previous ? 'opponent-disruption' : undefined)
        }) as IntentTransition;
    }
}
