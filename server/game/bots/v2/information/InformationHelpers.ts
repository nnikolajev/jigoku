import type { BotActionCandidate } from '../model/Candidate';
import { candidateId } from '../model/Candidate';
import type { EffectDescriptor } from '../model/Effects';
import type { PlanningState } from '../model/PlanningState';
import type { PlayerId } from '../model/References';
import { immutable, stableHash } from '../model/Stable';
import type {
    HandHypothesis,
    OpponentCardModel,
    OpponentResponsePackage,
    PublicOpponentEvidence
} from './OpponentInformationProvider';

export function opponentId(state: PlanningState): PlayerId {
    return Object.keys(state.players).find((id) => id !== state.perspectivePlayerId) || 'Opponent';
}

export function normalizeCard(card: any): OpponentCardModel {
    return {
        id: String(card.id), name: card.name,
        type: String(card.type || ''), fate: Math.max(0, Number(card.fate ?? card.cost) || 0),
        military: Math.max(0, Number(card.military ?? card.mil) || 0),
        political: Math.max(0, Number(card.political ?? card.pol) || 0),
        militaryBonus: Number(card.militaryBonus ?? card.milBonus) || 0,
        politicalBonus: Number(card.politicalBonus ?? card.polBonus) || 0,
        swing: Number(card.swing) || 0, tag: card.tag,
        conflictTypes: card.conflictTypes,
        canDisableDefender: !!card.canDisableDefender,
        canBowOpponent: !!card.canBowOpponent,
        usageKey: card.usageKey
    };
}

function effectsFor(card: OpponentCardModel, state: PlanningState, opponent: PlayerId): readonly EffectDescriptor[] {
    const own = state.characters.filter((character) => character.controllerId === state.perspectivePlayerId && character.ready)
        .sort((left, right) => (right.military + right.political) - (left.military + left.political) || left.instanceId.localeCompare(right.instanceId));
    const theirs = state.characters.filter((character) => character.controllerId === opponent && character.participating)
        .sort((left, right) => (right.military + right.political) - (left.military + left.political) || left.instanceId.localeCompare(right.instanceId));
    const ownTarget = own[0] ? { kind: 'character' as const, instanceId: own[0].instanceId, cardId: own[0].cardId, controllerId: own[0].controllerId } : undefined;
    const theirTarget = theirs[0] ? { kind: 'character' as const, instanceId: theirs[0].instanceId, cardId: theirs[0].cardId, controllerId: theirs[0].controllerId } : undefined;
    if(card.canBowOpponent && ownTarget) return [{ kind: 'bow', target: ownTarget }];
    if(card.canDisableDefender && ownTarget) return [{ kind: 'remove', method: 'discard', target: ownTarget, confidence: 0.7 }];
    if(card.tag === 'removal' && ownTarget) return [{ kind: 'remove', method: 'discard', target: ownTarget, confidence: 0.7 }];
    if(card.tag === 'duel' && ownTarget) return [{ kind: 'duel', duelType: 'opponent-response', skillDelta: card.swing || 0, target: ownTarget }];
    if(card.tag === 'honor' && ownTarget) return [{ kind: 'status', status: 'dishonored', target: ownTarget, confidence: 0.65 }];
    const military = (card.military || 0) + (card.militaryBonus || 0) + (card.swing || 0);
    const political = (card.political || 0) + (card.politicalBonus || 0) + (card.swing || 0);
    if((military > 0 || political > 0) && theirTarget) return [{ kind: 'skill', military, political, duration: 'conflict', target: theirTarget }];
    if(card.tag === 'draw') return [{ kind: 'deck', draw: Math.max(1, card.swing || 1), target: { kind: 'player', id: opponent } }];
    return [];
}

function responseCandidate(card: OpponentCardModel, state: PlanningState, hypothesisWeight: number,
    index: number): BotActionCandidate | undefined {
    const opponent = opponentId(state);
    if(card.conflictTypes?.length && state.conflict?.type && !card.conflictTypes.includes(state.conflict.type)) return undefined;
    const effects = effectsFor(card, state, opponent);
    if(effects.length === 0) return undefined;
    const source = { kind: 'card' as const, instanceId: `hypothesis:${card.id}:${index}`, cardId: card.id, controllerId: opponent, location: 'hand' };
    const targets = effects.map((effect) => effect.target).filter(Boolean) as any[];
    const commandPreview = { command: 'cardClicked' as const, args: [source.instanceId], target: card.name || card.id };
    const identity = { kind: 'conflict-card' as const, source, targets, commandPreview };
    return immutable({
        ...identity,
        id: candidateId(identity),
        costs: { fate: card.fate, cards: 1 }, effects, prerequisites: [],
        tags: ['uncertain'], limits: card.usageKey ? [{ key: card.usageKey, scope: 'conflict', maximum: 1 }] : [],
        uncertainty: 1 - hypothesisWeight, confidence: hypothesisWeight,
        proposer: 'opponent-information'
    }) as BotActionCandidate;
}

export function responsePackages(state: PlanningState, hypotheses: readonly HandHypothesis[],
    evidence: PublicOpponentEvidence = {}, availableFate?: number): readonly OpponentResponsePackage[] {
    const opponent = opponentId(state);
    const fate = Math.max(0, availableFate ?? state.players[opponent]?.fate ?? 0);
    const used = new Set(evidence.usedLimits || []);
    const packages: OpponentResponsePackage[] = [];
    for(const hypothesis of hypotheses) {
        const candidates = hypothesis.cards.map((card, index) => responseCandidate(card, state, hypothesis.weight, index))
            .filter((candidate): candidate is BotActionCandidate => !!candidate)
            .filter((candidate) => candidate.limits.every((limit) => !used.has(limit.key)))
            .sort((left, right) => left.costs.fate! - right.costs.fate! || left.id.localeCompare(right.id));
        const subsets: BotActionCandidate[][] = [];
        for(const candidate of candidates) {
            subsets.push([candidate]);
            for(const prior of candidates) {
                if(prior.id < candidate.id) subsets.push([prior, candidate]);
            }
        }
        for(const subset of subsets) {
            const limitCounts = new Map<string, number>();
            let limitsLegal = true;
            for(const candidate of subset) {
                for(const limit of candidate.limits) {
                    const next = (limitCounts.get(limit.key) || 0) + 1;
                    limitCounts.set(limit.key, next);
                    if(next > limit.maximum) limitsLegal = false;
                }
            }
            if(!limitsLegal) continue;
            const fateCost = subset.reduce((sum, candidate) => sum + (candidate.costs.fate || 0), 0);
            if(fateCost > fate) continue;
            const cardIds = subset.map((candidate) => candidate.source!.cardId!).sort();
            packages.push({
                id: `response:${stableHash({ hypothesis: hypothesis.id, cardIds })}`,
                candidates: subset, fateCost, cardIds, weight: hypothesis.weight,
                certainty: hypothesis.exact ? 1 : hypothesis.weight,
                rationale: [`shared-fate=${fateCost}/${fate}`, `hypothesis=${hypothesis.id}`]
            });
        }
    }
    const deduped = new Map<string, OpponentResponsePackage>();
    for(const pkg of packages.sort((left, right) =>
        right.certainty - left.certainty || right.fateCost - left.fateCost || left.id.localeCompare(right.id))) {
        const key = stableHash({ cards: pkg.cardIds, fate: pkg.fateCost });
        if(!deduped.has(key)) deduped.set(key, pkg);
    }
    return immutable([...deduped.values()].slice(0, 24)) as readonly OpponentResponsePackage[];
}
