// Scores candidates into the multi-component `UtilityVector`, then ranks.
//
// `semanticCandidateOrderKey` gives a deterministic tie-break: equal-utility
// candidates must sort identically across runs or self-play stops being
// reproducible. Weights come from the deck's V2 profile, so an A/B arm is a
// JSON string rather than an edit.
import type { BotActionCandidate } from './model/Candidate';
import type { PlanConstraint } from './model/Intent';
import type { PlanningState } from './model/PlanningState';
import {
    addUtility,
    emptyUtility,
    scalarUtility,
    type ScoredUtility,
    type UtilityVector,
    type UtilityWeights
} from './model/Utility';
import { immutable } from './model/Stable';
import {
    exactConflictContribution,
    hasDirectStrongholdBreak,
    requiredConflictContribution,
    requiredStrongholdContribution
} from './ConflictThresholds';
import { characterMaterialValue } from './BoardValue';

export interface CandidateScoreAdjustment {
    readonly candidateId?: string;
    readonly kind?: string;
    readonly tag?: string;
    readonly delta: Partial<UtilityVector>;
    readonly reason: string;
}

export interface UtilityProfile {
    readonly weights?: UtilityWeights;
    readonly adjustments?: readonly CandidateScoreAdjustment[];
    readonly constraints?: readonly PlanConstraint[];
    readonly searchLimits?: {
        readonly depth?: number;
        readonly beamWidth?: number;
        readonly maxCandidates?: number;
        readonly nodeBudget?: number;
    };
}

function exactResourceCost(candidate: BotActionCandidate): number {
    return Math.max(0, candidate.costs.fate || 0) + Math.max(0, candidate.costs.cards || 0) +
        Math.max(0, candidate.costs.honor || 0);
}

export function semanticCandidateOrderKey(candidate: BotActionCandidate): string {
    const source = candidate.source?.cardId || candidate.source?.location || candidate.source?.instanceId || '';
    const targets = candidate.targets.map((target: any) => [
        target.kind, target.cardId || target.location || target.element || target.id || target.instanceId || '',
        target.controllerId || ''
    ].join(':')).join('|');
    return [candidate.kind, source, candidate.mode || '', targets,
        candidate.commandPreview.command, candidate.commandPreview.target || ''].join('|');
}

function terminalRank(state: PlanningState, candidate: BotActionCandidate): number {
    const contribution = exactConflictContribution(state, candidate);
    const strongholdRequired = requiredStrongholdContribution(state);
    const conflictRequired = requiredConflictContribution(state);
    if(candidate.tags.includes('offense') && hasDirectStrongholdBreak(candidate)) return 5;
    if(strongholdRequired > 0 && contribution >= strongholdRequired) {
        if(state.conflict?.attackerId === state.perspectivePlayerId && candidate.tags.includes('offense')) return 5;
        if(state.conflict?.defenderId === state.perspectivePlayerId && candidate.tags.includes('defense')) return 4;
    }
    if(conflictRequired > 0 && contribution >= conflictRequired && candidate.tags.includes('terminal')) {
        if(candidate.tags.includes('offense')) return 3;
        if(candidate.tags.includes('defense')) return 2;
    }
    return 1;
}

export function compareScored(left: { candidate: BotActionCandidate; score: ScoredUtility },
    right: { candidate: BotActionCandidate; score: ScoredUtility }): number {
    return right.score.terminalRank - left.score.terminalRank ||
        right.score.scalar - left.score.scalar ||
        exactResourceCost(left.candidate) - exactResourceCost(right.candidate) ||
        right.candidate.confidence - left.candidate.confidence ||
        left.candidate.uncertainty - right.candidate.uncertainty ||
        semanticCandidateOrderKey(left.candidate).localeCompare(semanticCandidateOrderKey(right.candidate)) ||
        left.candidate.id.localeCompare(right.candidate.id);
}

export default class UtilityEvaluator {
    evaluate(state: PlanningState, candidate: BotActionCandidate, profile: UtilityProfile = {}): ScoredUtility {
        let vector = emptyUtility();
        const explanation: string[] = [];
        const rank = terminalRank(state, candidate);
        if(rank > 1) {
            vector = addUtility(vector, { terminal: (rank - 1) * 1000 });
            explanation.push(`terminal-rank:${rank}`);
        }
        const fateCost = Math.max(0, candidate.costs.fate || 0);
        const cardCost = Math.max(0, candidate.costs.cards || 0);
        const honorCost = Math.max(0, candidate.costs.honor || 0);
        vector = addUtility(vector, { fate: -fateCost, cards: -cardCost, honor: -honorCost });
        if(fateCost || cardCost || honorCost) explanation.push(`cost:fate=${fateCost},cards=${cardCost},honor=${honorCost}`);
        if(candidate.kind === 'pass') {
            vector = addUtility(vector, { initiative: 1, flexibility: 0.5 });
            explanation.push('pass-preserves-initiative');
        }
        for(const effect of candidate.effects) {
            if(effect.kind === 'skill') {
                const conflict = state.conflict;
                const rawForType = conflict?.type === 'political'
                    ? Math.max(0, effect.political || 0)
                    : conflict?.type === 'military'
                        ? Math.max(0, effect.military || 0)
                        : Math.max(0, effect.military || 0) + Math.max(0, effect.political || 0);
                const target: any = effect.target;
                const targetCharacter = target?.instanceId
                    ? state.characters.find((entry) => entry.instanceId === target.instanceId)
                    : undefined;
                const exactTargetRelevant = !target || target.kind !== 'character' ||
                    !!targetCharacter?.participating && targetCharacter.controllerId === state.perspectivePlayerId;
                const raw = exactTargetRelevant ? rawForType : 0;
                const required = !conflict ? raw
                    : conflict.attackerId === state.perspectivePlayerId
                        ? Math.max(0, conflict.defenderSkill - conflict.attackerSkill + Math.max(1, conflict.breakThreshold))
                        : conflict.defenderId === state.perspectivePlayerId
                            ? Math.max(0, conflict.attackerSkill - conflict.defenderSkill + 1)
                            : 0;
                const useful = Math.min(raw, required || raw);
                const surplus = Math.max(0, raw - useful);
                vector = addUtility(vector, { conflictOutcome: useful + surplus * 0.2, waste: -surplus * 0.8 });
                explanation.push(`skill:useful=${useful},surplus=${surplus},required=${required}`);
            } else if(effect.kind === 'bow' || effect.kind === 'remove') {
                const target: any = effect.target;
                const character = target?.instanceId
                    ? state.characters.find((entry) => entry.instanceId === target.instanceId)
                    : undefined;
                const attachmentParent = target?.instanceId
                    ? state.characters.find((entry) => entry.attachments?.some((attachment) =>
                        attachment.instanceId === target.instanceId))
                    : undefined;
                const attachment = attachmentParent?.attachments.find((entry) =>
                    entry.instanceId === target.instanceId);
                if(character) {
                    const opponent = character.controllerId !== state.perspectivePlayerId;
                    const sign = opponent ? 1 : -1;
                    const relevantSkill = state.conflict?.type === 'political'
                        ? character.political : character.military;
                    const current = character.participating && !character.bowed ? Math.max(0, relevantSkill) : 0;
                    const material = characterMaterialValue(state, character);
                    const future = effect.kind === 'remove' ? Math.max(0, material - current * 2) : 0;
                    vector = addUtility(vector, {
                        boardNow: sign * (current + (effect.kind === 'remove' ? 1 : 0)),
                        boardFuture: sign * future * 0.5,
                        conflictOutcome: sign * current
                    });
                    explanation.push(`${effect.kind}:${opponent ? 'opponent' : 'friendly'}:current=${current},material=${material}${effect.cost ? ':cost' : ''}`);
                } else if(effect.kind === 'remove' && attachmentParent && attachment) {
                    const opponent = attachmentParent.controllerId !== state.perspectivePlayerId;
                    const sign = opponent ? 1 : -1;
                    const relevantBonus = state.conflict?.type === 'political'
                        ? attachment.politicalBonus : attachment.militaryBonus;
                    const current = attachmentParent.participating && !attachmentParent.bowed
                        ? Math.max(0, relevantBonus) : 0;
                    const future = Math.max(0, attachment.militaryBonus) +
                        Math.max(0, attachment.politicalBonus) + Math.max(0, attachment.printedCost || 0);
                    vector = addUtility(vector, {
                        boardNow: sign * (current + 1),
                        boardFuture: sign * future * 0.5,
                        conflictOutcome: sign * current
                    });
                    explanation.push(`remove:${opponent ? 'opponent' : 'friendly'}-attachment:current=${current},future=${future}`);
                } else {
                    vector = addUtility(vector, { boardNow: 0.5, conflictOutcome: 0.5, uncertainty: -1 });
                    explanation.push(`${effect.kind}:unbound-target`);
                }
            } else if(effect.kind === 'move' &&
                (candidate.kind === 'attacker-set' || candidate.kind === 'defender-set')) {
                // Declaring a participant consumes future board flexibility;
                // the set planner scores threshold and preserved board once.
                explanation.push('participant-commitment');
            } else if(effect.kind === 'ready' || effect.kind === 'move') {
                vector = addUtility(vector, { boardNow: 2, boardFuture: 1, flexibility: 1 });
                explanation.push(effect.kind);
            } else if(effect.kind === 'status') {
                const target: any = effect.target;
                const character = target?.instanceId
                    ? state.characters.find((entry) => entry.instanceId === target.instanceId)
                    : undefined;
                const improvesOwn = effect.status === 'honored' &&
                    character?.controllerId === state.perspectivePlayerId && !character.honored;
                const weakensOpponent = effect.status === 'dishonored' &&
                    character?.controllerId !== state.perspectivePlayerId && !character.dishonored;
                const swing = improvesOwn || weakensOpponent ? Math.max(0, character?.glory || 0) : 0;
                const current = character?.participating ? swing : 0;
                vector = addUtility(vector, {
                    conflictOutcome: current,
                    boardNow: swing * 0.5,
                    boardFuture: character && character.fate > 0 ? swing * 0.25 : 0
                });
                explanation.push(`status:${effect.status}:swing=${swing},current=${current}`);
            } else if(effect.kind === 'resource') {
                vector = addUtility(vector, { fate: effect.fate || 0, cards: effect.cards || 0, honor: effect.honor || 0 });
                explanation.push('resource-effect');
            } else if(effect.kind === 'deck') {
                const hand = state.hands.find((entry) => entry.playerId === state.perspectivePlayerId);
                const draw = Math.max(0, effect.draw || 0);
                const usable = Math.min(draw, Math.max(0, 8 - (hand?.size || 0)));
                vector = addUtility(vector, { cards: usable, waste: -(draw - usable), conflictDeckSafety: -Math.max(0, draw - state.players[state.perspectivePlayerId].conflictDeckSize) * 5 });
                explanation.push(`draw:usable=${usable},dead=${draw - usable}`);
            } else if(effect.kind === 'ring') {
                vector = addUtility(vector, { ringValue: (effect.resolve ? 2 : 0) + (effect.claim ? 1 : 0), fate: effect.fate || 0 });
                explanation.push(`ring:${effect.element}`);
            } else if(effect.kind === 'province' && effect.break) {
                vector = addUtility(vector, { provinceTempo: effect.location === 'stronghold province' ? 100 : 8 });
                explanation.push(`break:${effect.location}`);
            } else if(effect.kind === 'attachment') {
                const duplicate = !!effect.nonStackingKey && state.characters.some((character) =>
                    character.attachments.some((attachment) => attachment.nonStackingKeys.includes(effect.nonStackingKey!)));
                vector = addUtility(vector, duplicate ? { waste: -5 } : { boardNow: 1.5, boardFuture: 1.5 });
                explanation.push(duplicate ? 'duplicate-attachment' : 'attachment-value');
            } else if(effect.kind === 'cancel' || effect.kind === 'prevention') {
                vector = addUtility(vector, { boardNow: 3, risk: 2, flexibility: 1 });
                explanation.push(`${effect.kind}:${effect.event}`);
            } else if(effect.kind === 'reduction') {
                const useful = Math.min(effect.amount, fateCost);
                vector = addUtility(vector, { fate: useful, waste: -(effect.amount - useful) });
                explanation.push(`reducer:useful=${useful}`);
            } else if(effect.kind === 'conflict' && effect.extraOpportunity) {
                vector = addUtility(vector, { provinceTempo: effect.extraOpportunity * 3, flexibility: effect.extraOpportunity * 2 });
                explanation.push('extra-conflict');
            }
        }
        if(candidate.tags.includes('defense')) {
            const strongholdRequired = requiredStrongholdContribution(state);
            const preventsImmediateBreak = strongholdRequired > 0 &&
                exactConflictContribution(state, candidate) >= strongholdRequired;
            vector = addUtility(vector, { strongholdSafety: preventsImmediateBreak ? 50 : 2 });
            explanation.push(preventsImmediateBreak ? 'stronghold-save:exact-threshold' : 'ordinary-defense');
        }
        if(candidate.tags.includes('setup')) vector = addUtility(vector, { comboProgress: 2, boardFuture: 1 });
        if(candidate.tags.includes('payoff')) vector = addUtility(vector, { comboProgress: 4 });
        if(candidate.uncertainty > 0) {
            vector = addUtility(vector, { uncertainty: -candidate.uncertainty * 3, risk: -candidate.uncertainty * 2 });
            explanation.push(`uncertainty:${candidate.uncertainty}`);
        }
        const me = state.players[state.perspectivePlayerId];
        const fateAfter = me.fate - fateCost;
        if(fateAfter > 0 && candidate.kind === 'pass' && state.phase !== 'dynasty') {
            vector = addUtility(vector, { waste: -Math.max(0, fateAfter - 3) * 0.25 });
            explanation.push('possibly-unspendable-fate');
        }
        for(const adjustment of profile.adjustments || []) {
            if((!adjustment.candidateId || adjustment.candidateId === candidate.id) &&
                (!adjustment.kind || adjustment.kind === candidate.kind) &&
                (!adjustment.tag || candidate.tags.includes(adjustment.tag as any))) {
                vector = addUtility(vector, adjustment.delta);
                explanation.push(`profile:${adjustment.reason}`);
            }
        }
        for(const annotation of candidate.annotations || []) {
            if(annotation.scoreDelta) {
                vector = addUtility(vector, annotation.scoreDelta);
                explanation.push(`contributor:${annotation.proposer}${annotation.note ? `:${annotation.note}` : ''}`);
            }
        }
        return immutable({
            vector,
            scalar: scalarUtility(vector, profile.weights),
            explanation,
            terminalRank: rank
        }) as ScoredUtility;
    }
}
