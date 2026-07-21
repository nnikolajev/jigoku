import type { BotActionCandidate } from '../model/Candidate';
import type { PlanningState } from '../model/PlanningState';
import type { CharacterAllocation } from './CharacterAllocator';
import { immutable } from '../model/Stable';

export interface TimedCandidate {
    readonly candidate: BotActionCandidate;
    readonly timingScore: number;
    readonly reasons: readonly string[];
}

export default class ActionTimingEvaluator {
    rank(state: PlanningState, candidates: readonly BotActionCandidate[], allocation: CharacterAllocation,
        opponentCommittedSkill = state.conflict?.defenderSkill || 0): readonly TimedCandidate[] {
        const required = state.conflict ? Math.max(0, opponentCommittedSkill + 1 - state.conflict.attackerSkill) : 0;
        return immutable(candidates.map((candidate) => {
            const reasons: string[] = [];
            let timingScore = 0;
            const contribution = candidate.effects.reduce((sum, effect) =>
                sum + (effect.kind === 'skill' ? Math.max(effect.military || 0, effect.political || 0) : 0), 0);
            if(candidate.kind === 'pass') {
                timingScore += opponentCommittedSkill <= 0 ? 2 : -Math.min(4, required);
                reasons.push(opponentCommittedSkill <= 0 ? 'pressure-opponent-to-commit' : 'pass-risks-current-threshold');
            }
            if(candidate.effects.some((effect) => effect.kind === 'prevention' || effect.kind === 'cancel')) {
                timingScore += 4;
                reasons.push('preventive-action-before-threat');
            }
            if(contribution > 0) {
                const useful = Math.min(contribution, required || contribution);
                timingScore += useful - Math.max(0, contribution - useful) * 0.75;
                reasons.push(`minimum-response:useful=${useful}`);
            }
            if(candidate.kind === 'attacker-set' && allocation.currentSkill > 0) {
                timingScore += Math.min(allocation.currentSkill, state.conflict?.provinceStrength || allocation.currentSkill);
                reasons.push('matches-multi-conflict-allocation');
            }
            return { candidate, timingScore, reasons };
        }).sort((left, right) => right.timingScore - left.timingScore || left.candidate.id.localeCompare(right.candidate.id))) as readonly TimedCandidate[];
    }
}
