import { getPlaybookEntry } from '../../CardPlaybook.js';
import { getCardModel } from '../../DeckAnalysis.js';
import type { BotActionCandidate, UsageLimit } from '../model/Candidate';
import type { DynamicEffectEvaluator, EffectDescriptor } from '../model/Effects';
import type { PlanningState } from '../model/PlanningState';
import type { TargetRef } from '../model/References';
import { immutable, stableHash } from '../model/Stable';

export type SemanticTiming = 'setup' | 'dynasty' | 'conflict-phase' | 'conflict' | 'reaction' | 'interrupt' | 'fate' | 'any';
export type SemanticTargetSide = 'self' | 'opponent' | 'either' | 'none';

export interface TargetSemantic {
    readonly kind: 'character' | 'attachment' | 'province' | 'ring' | 'player' | 'card';
    readonly side: SemanticTargetSide;
    readonly participating?: boolean;
    readonly ready?: boolean;
    readonly traits?: readonly string[];
    readonly maximum?: number;
}

export interface CostSemantic {
    readonly fate?: number;
    readonly honor?: number;
    readonly cards?: number;
    readonly bowSource?: boolean;
    readonly sacrificeSource?: boolean;
    readonly alternative?: string;
}

export interface ActionSemantic {
    readonly id: string;
    readonly timings: readonly SemanticTiming[];
    readonly targets: readonly TargetSemantic[];
    readonly cost: CostSemantic;
    readonly effects: readonly EffectDescriptor[];
    readonly stackingKey?: string;
    readonly limits: readonly UsageLimit[];
    readonly delayed?: boolean;
    readonly condition?: string;
    readonly confidence: number;
    readonly dynamicEvaluator?: DynamicEffectEvaluator<PlanningState, BotActionCandidate>;
}

export interface StaticSemantic {
    readonly id: string;
    readonly effects: readonly EffectDescriptor[];
    readonly condition?: string;
}

export interface TriggerSemantic extends ActionSemantic {
    readonly trigger: string;
}

export interface StackingRule {
    readonly key: string;
    readonly maximumUsefulCopies: number;
    readonly perTarget: boolean;
    readonly replacementAllowed?: boolean;
}

export type SynergyRole =
    | 'setup' | 'payoff' | 'reducer' | 'enabler' | 'protection' | 'mutually-exclusive';

export interface SynergyEdge {
    readonly id: string;
    readonly role: SynergyRole;
    readonly withCardIds?: readonly string[];
    readonly withTags?: readonly string[];
    readonly mutuallyExclusiveWith?: readonly string[];
    readonly scoreDelta: number;
    readonly condition?: string;
}

export interface CardSemanticModel {
    readonly cardId: string;
    readonly actions: readonly ActionSemantic[];
    readonly staticEffects?: readonly StaticSemantic[];
    readonly triggers?: readonly TriggerSemantic[];
    readonly targetRules?: readonly TargetSemantic[];
    readonly stacking?: readonly StackingRule[];
    readonly synergies?: readonly SynergyEdge[];
    readonly planningTags?: readonly string[];
    readonly source: 'v2-curated' | 'card-playbook' | 'deck-analysis';
    readonly confidence: number;
}

export interface SemanticCoverageEntry {
    readonly cardId: string;
    readonly status: 'supported' | 'low-confidence' | 'unknown';
    readonly confidence: number;
    readonly source?: CardSemanticModel['source'];
    readonly v1Fallback: true;
}

export interface SemanticProjection {
    readonly actionId: string;
    readonly effects: readonly EffectDescriptor[];
    readonly confidence: number;
    readonly notes: readonly string[];
}

function derivedModel(cardId: string): CardSemanticModel | undefined {
    const playbook = getPlaybookEntry(cardId);
    const analysis = getCardModel(cardId);
    if(!playbook && !analysis) return undefined;
    const effects: EffectDescriptor[] = [];
    if(analysis) {
        if(analysis.milBonus || analysis.polBonus) effects.push({ kind: 'skill', military: analysis.milBonus, political: analysis.polBonus, duration: analysis.type === 'attachment' ? 'while-attached' : 'conflict' });
        if(analysis.tag === 'removal') effects.push({ kind: 'remove', method: 'discard', confidence: 0.45 });
        if(analysis.tag === 'honor') effects.push({ kind: 'status', status: 'honored', confidence: 0.45 });
        if(analysis.tag === 'draw') effects.push({ kind: 'deck', draw: Math.max(1, playbook?.optionalDrawCards || 1), confidence: 0.5 });
        if(analysis.tag === 'duel') effects.push({ kind: 'duel', duelType: 'printed-card', skillDelta: analysis.swing, confidence: 0.45 });
        if(analysis.swing > 0 && effects.length === 0) effects.push({ kind: 'skill', military: analysis.swing, political: analysis.swing, duration: 'conflict', confidence: 0.4 });
    }
    if(playbook?.conflictContribution && typeof playbook.conflictContribution === 'number' &&
        !effects.some((effect) => effect.kind === 'skill')) {
        effects.push({ kind: 'skill', military: playbook.conflictContribution, political: playbook.conflictContribution, duration: 'conflict', confidence: 0.55 });
    }
    return immutable({
        cardId,
        actions: [{
            id: `${cardId}:derived`, timings: ['any'], targets: [{ kind: 'card', side: 'either' }],
            cost: { fate: analysis?.fate || 0 }, effects, limits: playbook?.oncePerRound
                ? [{ key: cardId, scope: 'round', maximum: 1 }]
                : [], confidence: playbook ? 0.6 : 0.45
        }],
        source: playbook ? 'card-playbook' : 'deck-analysis',
        planningTags: analysis?.tag ? [analysis.tag] : [],
        confidence: playbook ? 0.6 : 0.45
    }) as CardSemanticModel;
}

/** Bounds dynamic projections and cannot expose command execution through its contract. */
export function boundedDynamicEvaluator(id: string,
    evaluate: DynamicEffectEvaluator<PlanningState, BotActionCandidate>['evaluate'], maximumEffects = 8
): DynamicEffectEvaluator<PlanningState, BotActionCandidate> {
    const bound = Math.max(0, Math.floor(maximumEffects));
    return {
        id,
        evaluate(state, candidate) {
            const result = evaluate(state, candidate);
            const bounded = result.effects.slice(0, bound);
            const notes = bounded.length === result.effects.length
                ? result.notes
                : [...result.notes, `effect-bound:${bound}`];
            return immutable({
                effects: bounded,
                confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
                notes
            });
        }
    };
}

export default class CardSemanticRegistry {
    private readonly models = new Map<string, CardSemanticModel>();

    constructor(models: readonly CardSemanticModel[] = []) {
        for(const model of models) this.register(model);
    }

    register(model: CardSemanticModel): void {
        this.models.set(model.cardId, immutable(model) as CardSemanticModel);
    }

    get(cardId?: string): CardSemanticModel | undefined {
        if(!cardId) return undefined;
        return this.models.get(cardId) || derivedModel(cardId);
    }

    private actionFor(model: CardSemanticModel, candidate: BotActionCandidate): ActionSemantic {
        const mode = String(candidate.mode || candidate.commandPreview.target || '').toLowerCase();
        const modeWords = new Set(mode.split(/[^a-z0-9]+/).filter(Boolean));
        return model.actions.find((action) => {
            const semanticMode = action.id.split(':').pop()?.replaceAll('-', ' ') || '';
            const semanticWords = semanticMode.split(/[^a-z0-9]+/).filter(Boolean);
            return semanticWords.length > 0 && semanticWords.every((word) => modeWords.has(word));
        }) || model.actions[0];
    }

    project(cardId: string | undefined, state: PlanningState, candidate: BotActionCandidate,
        targets: readonly TargetRef[] = candidate.targets): SemanticProjection | undefined {
        const model = this.get(cardId);
        if(!model || model.actions.length === 0) return undefined;
        const action = this.actionFor(model, candidate);
        const target = targets[0];
        const staticEffects = action.effects.map((effect) => effect.target || !target ? effect : { ...effect, target });
        const dynamic = action.dynamicEvaluator?.evaluate(state, candidate);
        return immutable({
            actionId: action.id,
            effects: [...staticEffects, ...(dynamic?.effects || [])],
            confidence: Math.min(model.confidence, action.confidence, dynamic?.confidence ?? 1),
            notes: dynamic?.notes || []
        });
    }

    effectsFor(cardId: string | undefined, state: PlanningState, candidate: BotActionCandidate,
        targets: readonly TargetRef[] = candidate.targets): readonly EffectDescriptor[] {
        return this.project(cardId, state, candidate, targets)?.effects || [];
    }

    enrich(state: PlanningState, candidate: BotActionCandidate): BotActionCandidate {
        const cardId = candidate.source?.cardId;
        const model = this.get(cardId);
        if(!model || candidate.effects.length > 0) return candidate;
        const action = this.actionFor(model, candidate);
        const projection = this.project(cardId, state, candidate);
        return immutable({
            ...candidate,
            effects: projection?.effects || [],
            costs: {
                ...candidate.costs,
                fate: candidate.costs.fate ?? action.cost.fate,
                honor: candidate.costs.honor ?? action.cost.honor,
                cards: candidate.costs.cards ?? action.cost.cards
            },
            limits: [...candidate.limits, ...action.limits],
            uncertainty: Math.max(candidate.uncertainty, 1 - (projection?.confidence || model.confidence)),
            confidence: Math.min(candidate.confidence, projection?.confidence || model.confidence),
            annotations: [...(candidate.annotations || []), { proposer: `semantics:${model.source}`, note: action.id }]
        }) as BotActionCandidate;
    }

    coverage(cardIds: readonly string[]): readonly SemanticCoverageEntry[] {
        return [...new Set(cardIds)].sort().map((cardId) => {
            const model = this.get(cardId);
            return {
                cardId,
                status: !model ? 'unknown' : model.confidence < 0.7 ? 'low-confidence' : 'supported',
                confidence: model?.confidence || 0,
                source: model?.source,
                v1Fallback: true
            };
        });
    }

    hash(cardIds?: readonly string[]): string {
        const ids = cardIds ? [...new Set(cardIds)].sort() : [...this.models.keys()].sort();
        return stableHash(ids.map((id) => this.get(id)));
    }
}
