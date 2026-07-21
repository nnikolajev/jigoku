import type { BotActionCandidate, CandidateVeto } from './model/Candidate';
import type { EffectDescriptor } from './model/Effects';
import type { PlanningState } from './model/PlanningState';
import { immutable, stableSerialize } from './model/Stable';

export interface SafetyContext {
    readonly attemptedActionKeys?: readonly string[];
    readonly noProgressActionKeys?: readonly string[];
    readonly staleTargetIds?: readonly string[];
    readonly honorFloor?: number;
    readonly mandatoryDefenderCount?: number;
    readonly hardFateReserve?: number;
    readonly hardCardReserve?: number;
    readonly reservedCandidateIds?: readonly string[];
}

export interface VetoResult {
    readonly allowed: readonly BotActionCandidate[];
    readonly vetoed: readonly CandidateVeto[];
}

function targetId(target: any): string | undefined {
    return target?.instanceId || target?.id || target?.location || target?.element;
}

function actionKey(candidate: BotActionCandidate): string {
    return stableSerialize(candidate.commandPreview);
}

function effectTargetIsOwn(effect: EffectDescriptor, state: PlanningState): boolean {
    const target: any = effect.target;
    return target?.controllerId === state.perspectivePlayerId || target?.id === state.perspectivePlayerId;
}

function effectTargetIsOpponent(effect: EffectDescriptor, state: PlanningState): boolean {
    const target: any = effect.target;
    return !!target && !effectTargetIsOwn(effect, state);
}

function existingTargetIds(state: PlanningState): Set<string> {
    return new Set([
        ...Object.keys(state.players),
        ...state.characters.map((character) => character.instanceId),
        ...state.provinces.flatMap((province) => [province.instanceId, province.location]).filter(Boolean) as string[],
        ...state.rings.map((ring) => ring.element)
    ]);
}

function veto(candidate: BotActionCandidate, code: string, reason: string, safety = true): CandidateVeto {
    return { candidateId: candidate.id, vetoed: true, code, reason, safety };
}

export default class SafetyVetoPipeline {
    evaluate(state: PlanningState, candidates: readonly BotActionCandidate[], context: SafetyContext = {}): VetoResult {
        const allowed: BotActionCandidate[] = [];
        const vetoed: CandidateVeto[] = [];
        const existing = existingTargetIds(state);
        const stale = new Set(context.staleTargetIds || []);
        const attempted = new Set(context.attemptedActionKeys || []);
        const noProgress = new Set(context.noProgressActionKeys || []);
        const me = state.players[state.perspectivePlayerId];
        const ownStrongholdThreat = state.conflict?.defenderId === state.perspectivePlayerId &&
            state.conflict.provinceLocation === 'stronghold province';
        const readyDefenders = state.characters.filter((character) =>
            character.controllerId === state.perspectivePlayerId && character.ready).length;

        for(const candidate of candidates) {
            const failures: CandidateVeto[] = [];
            const passCommand = candidate.kind === 'pass' || /\bpass\b/i.test(String(candidate.commandPreview?.target || candidate.commandPreview?.args?.[0] || ''));
            if(!candidate.commandPreview?.command || !Array.isArray(candidate.commandPreview.args)) {
                failures.push(veto(candidate, 'illegal-command-preview', 'candidate has no normal Jigoku command descriptor'));
            }
            if(candidate.prerequisites.some((prerequisite) => !prerequisite.satisfied)) {
                failures.push(veto(candidate, 'prerequisite-failed', 'candidate has an unsatisfied legality or payoff prerequisite'));
            }
            const targets = candidate.targets.map(targetId).filter(Boolean) as string[];
            if(targets.some((id) => stale.has(id) || !existing.has(id))) {
                failures.push(veto(candidate, 'stale-target', 'candidate target is not present in the live planning snapshot'));
            }
            const key = actionKey(candidate);
            if(attempted.has(key)) failures.push(veto(candidate, 'attempted-click', 'candidate repeats an attempted command'));
            if(noProgress.has(key)) failures.push(veto(candidate, 'no-progress', 'candidate previously produced no material progress'));
            if(ownStrongholdThreat && passCommand) {
                failures.push(veto(candidate, 'terminal-loss', 'cannot pass while the stronghold requires a legal defense'));
            }
            if(ownStrongholdThreat && candidate.tags.includes('offense') && !candidate.tags.includes('defense')) {
                failures.push(veto(candidate, 'exposed-stronghold', 'offensive action violates stronghold survival priority'));
            }
            const honorAfter = me.honor - Math.max(0, candidate.costs.honor || 0);
            const reservedMember = new Set(context.reservedCandidateIds || []).has(candidate.id);
            const fateAfter = me.fate - Math.max(0, candidate.costs.fate || 0);
            if(!reservedMember && fateAfter < (context.hardFateReserve || 0)) {
                failures.push(veto(candidate, 'hard-fate-reserve', 'candidate would break a terminal resource-package fate reservation'));
            }
            const handSize = state.hands.find((hand) => hand.playerId === state.perspectivePlayerId)?.size || 0;
            if(!reservedMember && handSize - Math.max(0, candidate.costs.cards || 0) < (context.hardCardReserve || 0)) {
                failures.push(veto(candidate, 'hard-card-reserve', 'candidate would break a terminal resource-package card reservation'));
            }
            if(honorAfter <= (context.honorFloor ?? 0) && !candidate.tags.includes('terminal')) {
                failures.push(veto(candidate, 'honor-floor', 'candidate spends honor at or below the configured survival floor'));
            }
            const ownHand = state.hands.find((hand) => hand.playerId === state.perspectivePlayerId);
            const draw = candidate.effects.filter((effect) => effect.kind === 'deck')
                .reduce((sum, effect: any) => sum + Math.max(0, effect.draw || 0), 0);
            if(draw > me.conflictDeckSize && me.honor <= 5 && !candidate.tags.includes('terminal')) {
                failures.push(veto(candidate, 'conflict-deck-exhaustion', 'optional draw risks lethal conflict-deck exhaustion'));
            }
            if(ownStrongholdThreat && (context.mandatoryDefenderCount || 0) > readyDefenders && candidate.kind !== 'defender-set') {
                failures.push(veto(candidate, 'mandatory-defense', 'candidate does not satisfy mandatory defender reserve'));
            }
            for(const effect of candidate.effects) {
                if((effect.kind === 'bow' || effect.kind === 'remove' ||
                    (effect.kind === 'status' && effect.status === 'dishonored')) &&
                    effectTargetIsOwn(effect, state) && !candidate.tags.includes('setup')) {
                    failures.push(veto(candidate, 'target-polarity', 'harmful effect targets a friendly object'));
                }
                if((effect.kind === 'ready' || (effect.kind === 'status' && effect.status === 'honored')) &&
                    effectTargetIsOpponent(effect, state)) {
                    failures.push(veto(candidate, 'target-polarity', 'beneficial effect targets an opponent object'));
                }
                if(effect.kind === 'attachment' && effect.nonStackingKey) {
                    const id = targetId(effect.target);
                    const character = state.characters.find((entry) => entry.instanceId === id);
                    if(character?.attachments.some((attachment) => attachment.nonStackingKeys.includes(effect.nonStackingKey!))) {
                        failures.push(veto(candidate, 'duplicate-non-stacking-effect', 'target already has the non-stacking attachment effect'));
                    }
                }
                if(effect.kind === 'reduction' && candidate.costs.fate !== undefined && candidate.costs.fate <= 0) {
                    failures.push(veto(candidate, 'impossible-payoff', 'reducer cannot improve a zero-cost action'));
                }
            }
            if(candidate.source && state.ledgers.reducersConsumed.includes(candidate.source.instanceId) && candidate.tags.includes('reducer')) {
                failures.push(veto(candidate, 'reducer-consumed', 'candidate tries to consume an already used reducer'));
            }
            for(const effect of candidate.effects) {
                const id = targetId(effect.target);
                const key = `${effect.kind}:${(effect as any).nonStackingKey || (effect as any).status || ''}`;
                if(id && state.ledgers.effectTargets[key]?.includes(id)) {
                    failures.push(veto(candidate, 'duplicate-effect-target', 'effect ledger records this target already'));
                }
            }
            if(failures.length > 0) vetoed.push(...failures);
            else allowed.push(candidate);
            void ownHand;
        }
        return immutable({ allowed, vetoed }) as VetoResult;
    }
}

export { actionKey as candidateActionKey };
