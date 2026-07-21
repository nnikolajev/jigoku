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

function targetIsStronghold(candidate: BotActionCandidate): boolean {
    return candidate.targets.some((target: any) => target.kind === 'province' && target.location === 'stronghold province') ||
        candidate.effects.some((effect: any) => effect.kind === 'province' && effect.location === 'stronghold province' && effect.break);
}

function terminalRank(state: PlanningState, candidate: BotActionCandidate): number {
    const strongholdThreat = state.conflict?.defenderId === state.perspectivePlayerId &&
        state.conflict.provinceLocation === 'stronghold province';
    if(targetIsStronghold(candidate) && candidate.tags.includes('offense')) return 5;
    if(strongholdThreat && candidate.tags.includes('defense')) return 4;
    if(candidate.tags.includes('terminal') && candidate.tags.includes('offense')) return 3;
    if(candidate.tags.includes('terminal') && candidate.tags.includes('defense')) return 2;
    return 1;
}

export function compareScored(left: { candidate: BotActionCandidate; score: ScoredUtility },
    right: { candidate: BotActionCandidate; score: ScoredUtility }): number {
    return right.score.terminalRank - left.score.terminalRank ||
        right.score.scalar - left.score.scalar ||
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
                const raw = Math.max(0, effect.military || 0) + Math.max(0, effect.political || 0);
                const conflict = state.conflict;
                const required = conflict
                    ? Math.max(0, conflict.defenderSkill - conflict.attackerSkill + Math.max(1, conflict.breakThreshold))
                    : raw;
                const useful = Math.min(raw, required || raw);
                const surplus = Math.max(0, raw - useful);
                vector = addUtility(vector, { conflictOutcome: useful + surplus * 0.2, waste: -surplus * 0.8 });
                explanation.push(`skill:useful=${useful},surplus=${surplus}`);
            } else if(effect.kind === 'bow' || effect.kind === 'remove') {
                vector = addUtility(vector, { boardNow: 3, conflictOutcome: 2 });
                explanation.push(`${effect.kind}-control`);
            } else if(effect.kind === 'ready' || effect.kind === 'move') {
                vector = addUtility(vector, { boardNow: 2, boardFuture: 1, flexibility: 1 });
                explanation.push(effect.kind);
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
        if(candidate.tags.includes('defense')) vector = addUtility(vector, { strongholdSafety: state.conflict?.provinceLocation === 'stronghold province' ? 50 : 2 });
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
